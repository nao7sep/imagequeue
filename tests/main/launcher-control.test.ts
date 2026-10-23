import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startLauncherControl, type LauncherControl } from '../../src/main/launcher-control'

const tempRoot = os.tmpdir()
let directory: string
const controls: LauncherControl[] = []
beforeEach(async () => {
  directory = await mkdtemp(path.join(tempRoot, 'imagequeue-launcher-control-'))
  vi.spyOn(os, 'tmpdir').mockReturnValue(directory)
  vi.stubEnv('IMAGEQUEUE_LAUNCH_TOKEN', undefined)
})
afterEach(async () => {
  await Promise.all(controls.splice(0).map((control) => control.close()))
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

const handshakePath = (token: string): string => path.join(directory, `imagequeue-launch-${token}.json`)
async function handshake(token: string): Promise<{ token: string; pid: number; port: number }> {
  return JSON.parse(await readFile(handshakePath(token), 'utf8'))
}
function request(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' }, () => socket.write(text))
    let response = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => { response += chunk })
    socket.on('error', reject)
    socket.on('close', () => resolve(response))
  })
}

async function start(status: () => 'starting' | 'ready' | 'failed', quit = vi.fn()) {
  const token = randomUUID()
  const control = (await startLauncherControl({ status, quit }, token))!
  controls.push(control)
  return { control, quit, ...await handshake(token) }
}

describe('launcher control', () => {
  it('does nothing without a token and rejects invalid tokens without publication', async () => {
    const server = vi.spyOn(net, 'createServer')
    await expect(startLauncherControl({ status: () => 'starting', quit: vi.fn() })).resolves.toBeNull()
    for (const token of ['', '../escape', 'not-a-uuid']) {
      await expect(startLauncherControl({ status: () => 'starting', quit: vi.fn() }, token)).rejects.toThrow('UUID')
    }
    expect(server).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual([])
  })

  it('publishes a private loopback endpoint and reports current startup readiness', async () => {
    let status: 'starting' | 'ready' | 'failed' = 'starting'
    const service = await start(() => status)
    expect(await handshake(service.token)).toEqual({ token: service.token, pid: process.pid, port: service.port })
    if (process.platform !== 'win32') expect((await stat(handshakePath(service.token))).mode & 0o777).toBe(0o600)
    const read = () => request(service.port, `${JSON.stringify({ token: service.token, command: 'status' })}\n`)
    expect(JSON.parse(await read())).toEqual({ token: service.token, pid: process.pid, status: 'starting' })
    status = 'ready'
    expect(JSON.parse(await read()).status).toBe('ready')
    status = 'failed'
    expect(JSON.parse(await read()).status).toBe('failed')
    expect(service.quit).not.toHaveBeenCalled()
  })

  it('rejects missing or wrong authentication and unknown commands without quitting', async () => {
    const { token, port, quit } = await start(() => 'ready')
    for (const message of [
      { command: 'quit' }, { token: randomUUID(), command: 'quit' }, { token, command: 'force' },
    ]) expect(await request(port, `${JSON.stringify(message)}\n`)).toBe('')
    expect(await request(port, '{bad json}\n')).toBe('')
    expect(quit).not.toHaveBeenCalled()
  })

  it('acknowledges an authenticated quit then uses the ordinary callback even when the app remains alive', async () => {
    const { token, port, quit } = await start(() => 'ready')
    expect(JSON.parse(await request(port, `${JSON.stringify({ token, command: 'quit' })}\n`)))
      .toEqual({ token, pid: process.pid, status: 'quitting' })
    expect(quit).toHaveBeenCalledOnce()
    // The callback may be vetoed by the normal quit owner; the endpoint must
    // remain usable and report the app's actual status rather than force exit.
    expect(JSON.parse(await request(port, `${JSON.stringify({ token, command: 'status' })}\n`)).status).toBe('ready')
  })

  it('rejects oversized protocol input and closes connections owned by the service', async () => {
    const { port, control, quit, token } = await start(() => 'starting')
    expect(await request(port, `${' '.repeat(1024)}\n`)).toBe('')
    expect(quit).not.toHaveBeenCalled()
    const client = net.createConnection({ port, host: '127.0.0.1' })
    await new Promise<void>((resolve, reject) => { client.once('connect', resolve); client.once('error', reject) })
    const closed = new Promise<void>((resolve) => client.once('close', () => resolve()))
    client.write('{')
    await control.close()
    await closed
    await control.close()
    expect(await handshake(token)).toMatchObject({ port }) // Launcher owns removal.
  })

  it('ends incomplete requests after one five-second deadline despite new bytes', async () => {
    const schedule = vi.spyOn(globalThis, 'setTimeout')
    const create = net.createServer.bind(net)
    let accepted!: () => void
    const connected = new Promise<void>((resolve) => { accepted = resolve })
    vi.spyOn(net, 'createServer').mockImplementation((listener: unknown) => {
      const server = create(listener as (socket: net.Socket) => void)
      server.once('connection', () => accepted())
      return server
    })
    const { port, quit } = await start(() => 'starting')
    const client = net.createConnection({ port, host: '127.0.0.1' })
    await new Promise<void>((resolve, reject) => { client.once('connect', resolve); client.once('error', reject) })
    const closed = new Promise<void>((resolve) => client.once('close', () => resolve()))
    await connected
    const deadlines = () => schedule.mock.calls.filter(([, delay]) => delay === 5_000)
    expect(deadlines()).toHaveLength(1)
    client.write('{')
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(deadlines()).toHaveLength(1)
    // Dispatch the installed deadline without waiting five real seconds; the
    // request and its socket are real, and partial traffic did not rearm it.
    ;(deadlines()[0]![0] as () => void)()
    await closed
    expect(quit).not.toHaveBeenCalled()
  })

  it('atomically republishes the endpoint when a primary process restarts within the same launch generation', async () => {
    const first = await start(() => 'starting')
    await first.control.close()
    const replacement = (await startLauncherControl({ status: () => 'ready', quit: vi.fn() }, first.token))!
    controls.push(replacement)
    const next = await handshake(first.token)
    expect(next).toMatchObject({ token: first.token, pid: process.pid })
    expect(JSON.parse(await request(next.port, `${JSON.stringify({ token: first.token, command: 'status' })}\n`)))
      .toEqual({ token: first.token, pid: process.pid, status: 'ready' })
    expect(await readdir(directory)).toEqual([path.basename(handshakePath(first.token))])
  })

  it('releases its unpublished listener and removes staging files when atomic publication fails', async () => {
    const token = randomUUID()
    await mkdir(handshakePath(token))
    await writeFile(path.join(handshakePath(token), 'marker'), 'preexisting')
    const create = net.createServer.bind(net)
    let server!: net.Server
    let port = 0
    vi.spyOn(net, 'createServer').mockImplementation((listener: unknown) => {
      server = create(listener as (socket: net.Socket) => void)
      server.once('listening', () => { port = (server.address() as net.AddressInfo).port })
      return server
    })
    await expect(startLauncherControl({ status: () => 'starting', quit: vi.fn() }, token)).rejects.toThrow()
    expect(await readFile(path.join(handshakePath(token), 'marker'), 'utf8')).toBe('preexisting')
    expect(await readdir(directory)).toEqual([path.basename(handshakePath(token))])
    expect(server.listening).toBe(false)
    expect(port).toBeGreaterThan(0)
    await expect(request(port, '{}\n')).rejects.toMatchObject({ code: 'ECONNREFUSED' })
  })
})
