import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { open, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

export interface LauncherControl {
  close(): Promise<void>
}

interface LauncherActions {
  status(): 'starting' | 'ready' | 'failed'
  quit(): void
}

// This optional service belongs to one launcher-created process. The nonce
// authenticates both the request and response; quitting uses the app's normal
// quit owner and may be declined by its ordinary unsaved-work question.
export async function startLauncherControl(
  actions: LauncherActions,
  token = process.env['IMAGEQUEUE_LAUNCH_TOKEN'],
): Promise<LauncherControl | null> {
  if (token === undefined) return null
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
    throw new Error('The launcher control token must be a UUID.')
  }
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.unref()
    // An absolute request deadline also bounds clients that send a byte at a
    // time. Neither an idle connection nor the service keeps the app alive.
    const timeout = setTimeout(() => socket.destroy(), 5_000)
    timeout.unref()
    let pending = Buffer.alloc(0)
    socket.on('close', () => { clearTimeout(timeout); sockets.delete(socket) })
    socket.on('error', () => socket.destroy())
    socket.on('data', (chunk: Buffer) => {
      if (pending.length + chunk.length > 1024) { socket.destroy(); return }
      pending = Buffer.concat([pending, chunk])
      const newline = pending.indexOf(10)
      if (newline === -1) return
      socket.pause()
      let request: unknown
      try { request = JSON.parse(pending.subarray(0, newline).toString('utf8')) }
      catch { socket.destroy(); return }
      if (typeof request !== 'object' || request === null) { socket.destroy(); return }
      const { token: received, command } = request as Record<string, unknown>
      if (received !== token || (command !== 'status' && command !== 'quit')) { socket.destroy(); return }
      const response = { token, pid: process.pid, status: command === 'quit' ? 'quitting' : actions.status() }
      socket.end(`${JSON.stringify(response)}\n`, () => {
        if (command === 'quit') actions.quit()
      })
    })
  })
  server.unref()
  let closing: Promise<void> | null = null
  const control: LauncherControl = {
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error) reject(error); else resolve() })
        for (const socket of sockets) socket.destroy()
      })
      return closing
    },
  }
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error): void => { reject(error) }
    server.once('error', failed)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', failed)
      resolve()
    })
  })
  const handshake = path.join(os.tmpdir(), `imagequeue-launch-${token}.json`)
  const stage = path.join(os.tmpdir(), `imagequeue-launch-${token}-${randomUUID()}.tmp`)
  let stageOwned = false
  try {
    const { port } = server.address() as net.AddressInfo
    // A dev reload keeps its launch-generation token. Publish one complete
    // endpoint atomically, replacing that generation's previous process; the
    // primary-instance lock is acquired before this service starts.
    const file = await open(stage, 'wx', 0o600)
    stageOwned = true
    try { await file.writeFile(JSON.stringify({ token, pid: process.pid, port })) }
    finally { await file.close() }
    await rename(stage, handshake)
    stageOwned = false
  } catch (error) {
    await control.close()
    throw error
  } finally {
    if (stageOwned) await rm(stage, { force: true })
  }
  return control
}
