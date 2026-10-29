import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import type { Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadToFile } from '../../../src/main/dependencies/download'

// Delegate HTTPS transport to a real loopback HTTP server while preserving the
// production URL, path, request options and abort signal at its policy boundary.
// These fixtures exercise HTTP stream lifetime, redirects and file ownership;
// they deliberately do not exercise TLS certificate verification.
const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function destination(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-download-boundary-'))
  roots.push(root)
  return path.join(root, 'stage.bin')
}
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
async function loopback(
  listener: http.RequestListener,
  run: (url: (pathname: string) => string, port: number) => Promise<void>,
): Promise<void> {
  const sockets = new Set<Socket>()
  const server = http.createServer(listener)
  server.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing loopback address')
    const port = address.port
    vi.spyOn(https, 'request').mockImplementation(((url: string | URL, options: http.RequestOptions, callback: (response: http.IncomingMessage) => void) => {
      const parsed = new URL(url)
      return http.request({ ...options, hostname: '127.0.0.1', port, path: parsed.pathname + parsed.search }, callback)
    }) as typeof https.request)
    await run(pathname => `https://download.invalid${pathname}`, port)
  } finally {
    // Only sockets accepted by this fixture are destroyed. Await server close
    // so a failed assertion never leaves a listening server or held response.
    const closed = new Promise<void>(resolve => server.close(() => resolve()))
    for (const socket of sockets) socket.destroy()
    await closed
  }
}
function observeWriter(): { opened: Promise<void>; writers: fs.WriteStream[] } {
  const open = deferred()
  const writers: fs.WriteStream[] = []
  const create = fs.createWriteStream.bind(fs)
  vi.spyOn(fs, 'createWriteStream').mockImplementation((...args) => {
    const writer = create(...args)
    writers.push(writer)
    writer.once('open', open.resolve)
    return writer
  })
  return { opened: open.promise, writers }
}

describe('download HTTP and staging boundaries', () => {
  it('resolves a relative redirect and writes the final body', async () => {
    const requests: string[] = []
    const file = destination()
    await loopback((request, response) => {
      requests.push(request.url!)
      if (request.url === '/releases/start') response.writeHead(302, { Location: '../artifact?version=1' }).end()
      else response.end('complete artifact')
    }, async url => {
      await downloadToFile(url('/releases/start'), file)
      expect(fs.readFileSync(file, 'utf8')).toBe('complete artifact')
      expect(requests).toEqual(['/releases/start', '/artifact?version=1'])
    })
  })

  it('bounds redirect loops', async () => {
    let requests = 0
    const file = destination()
    await loopback((_request, response) => {
      requests++
      response.writeHead(302, { Location: '/loop' }).end()
    }, async url => {
      await expect(downloadToFile(url('/loop'), file)).rejects.toThrow('too many redirects')
      expect(requests).toBe(6)
      expect(fs.existsSync(file)).toBe(false)
    })
  })

  it('rejects a redirect downgrade before requesting the HTTP target', async () => {
    const requests: string[] = []
    await loopback((request, response) => {
      requests.push(request.url!)
      response.writeHead(302, { Location: 'http://download.invalid/insecure' }).end()
    }, async url => {
      await expect(downloadToFile(url('/secure'), destination())).rejects.toThrow('non-https')
      expect(requests).toEqual(['/secure'])
      expect(https.request).toHaveBeenCalledOnce()
    })
  })

  it('fails an incomplete Content-Length body and removes its owned stage after close', async () => {
    const file = destination()
    const writer = observeWriter()
    const progress = deferred()
    let response!: http.ServerResponse
    await loopback((_request, current) => {
      response = current
      current.writeHead(200, { 'Content-Length': '100' })
      current.write('partial')
    }, async url => {
      const pending = downloadToFile(url('/truncated'), file, progress.resolve)
      const rejected = expect(pending).rejects.toThrow()
      await Promise.all([writer.opened, progress.promise])
      response.socket!.destroy()
      await rejected
      expect(writer.writers[0].closed).toBe(true)
      expect(fs.existsSync(file)).toBe(false)
    })
  })

  it('preserves an existing destination when an otherwise successful body collides', async () => {
    const file = destination()
    fs.writeFileSync(file, 'existing artifact')
    await loopback((_request, response) => response.end('new artifact'), async url => {
      await expect(downloadToFile(url('/artifact'), file)).rejects.toMatchObject({ code: 'EEXIST' })
      expect(fs.readFileSync(file, 'utf8')).toBe('existing artifact')
    })
  })

  it('preserves an existing destination on invalid URL or cancellation before admission', async () => {
    const file = destination()
    fs.writeFileSync(file, 'existing artifact')
    const request = vi.spyOn(https, 'request')
    await expect(downloadToFile('not a URL', file)).rejects.toThrow('Invalid download URL')
    const controller = new AbortController()
    controller.abort(new Error('stopped before admission'))
    await expect(downloadToFile('https://download.invalid/artifact', file, undefined, controller.signal)).rejects.toThrow('stopped before admission')
    expect(request).not.toHaveBeenCalled()
    expect(fs.readFileSync(file, 'utf8')).toBe('existing artifact')
  })

  it('preserves an existing destination directory and its contents', async () => {
    const file = destination()
    fs.mkdirSync(file)
    fs.writeFileSync(path.join(file, 'kept.txt'), 'keep')
    await loopback((_request, response) => response.end('artifact'), async url => {
      await expect(downloadToFile(url('/artifact'), file)).rejects.toThrow()
      expect(fs.statSync(file).isDirectory()).toBe(true)
      expect(fs.readFileSync(path.join(file, 'kept.txt'), 'utf8')).toBe('keep')
    })
  })

  it('awaits destination close before removing its stage on midbody cancellation', async () => {
    const file = destination()
    const writer = observeWriter()
    const progress = deferred()
    const controller = new AbortController()
    const remove = fs.promises.rm.bind(fs.promises)
    const closeAtRemoval: boolean[] = []
    vi.spyOn(fs.promises, 'rm').mockImplementation(async (target, options) => {
      if (target === file) closeAtRemoval.push(writer.writers[0].closed)
      await remove(target, options)
    })
    await loopback((_request, response) => {
      response.writeHead(200, { 'Content-Length': '100' })
      response.write('partial')
    }, async url => {
      const pending = downloadToFile(url('/held'), file, progress.resolve, controller.signal)
      const rejected = expect(pending).rejects.toThrow()
      await Promise.all([writer.opened, progress.promise])
      controller.abort()
      await rejected
      expect(writer.writers[0].closed).toBe(true)
      expect(closeAtRemoval).toEqual([true])
      expect(fs.existsSync(file)).toBe(false)
    })
  })
})
