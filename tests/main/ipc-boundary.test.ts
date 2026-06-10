import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// The wrapper registers each handler with ipcMain.handle; capture the listener
// it passes so the test can invoke it the way Electron would and observe what
// crosses the boundary. electron has no meaning in the node test env, so it is
// stubbed down to the one method under test. vi.hoisted lets the (hoisted) mock
// factory share the registry with the test body.
const hoisted = vi.hoisted(() => ({
  registered: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) {
      hoisted.registered.set(channel, listener)
    },
  },
}))

import { handle } from '../../src/main/ipc-boundary'
import { initLogger } from '../../src/main/logger'

const createdDirs: string[] = []

// Points the real logger (no electron dependency) at a fresh session dir so the
// test can read back exactly what the wrapper wrote, rather than mocking log().
function freshSessionDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-ipc-'))
  createdDirs.push(dir)
  initLogger(dir)
  return dir
}

function readEntries(dir: string): Record<string, unknown>[] {
  const content = fs.readFileSync(path.join(dir, 'session.log'), 'utf-8')
  return content
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

// Invokes the listener registered for a channel as Electron's invoke path would:
// an opaque event followed by the renderer's args, result flattened to a promise.
function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const listener = hoisted.registered.get(channel)
  if (!listener) throw new Error(`no handler registered for ${channel}`)
  return Promise.resolve(listener({}, ...args))
}

beforeEach(() => {
  hoisted.registered.clear()
})

afterAll(() => {
  for (const dir of createdDirs) fs.rmSync(dir, { recursive: true, force: true })
})

describe('handle (IPC boundary wrapper)', () => {
  it('returns the handler result and logs nothing for sync and async successes', async () => {
    const dir = freshSessionDir()
    handle('ok:sync', (_event, a: number, b: number) => a + b)
    handle('ok:async', async (_event, name: string) => `hi ${name}`)

    await expect(invoke('ok:sync', 2, 3)).resolves.toBe(5)
    await expect(invoke('ok:async', 'cat')).resolves.toBe('hi cat')

    expect(readEntries(dir).some((entry) => entry.message === 'IPC handler failed')).toBe(false)
  })

  it('logs the channel + full error and still rejects when a sync handler throws', async () => {
    const dir = freshSessionDir()
    handle('boom:sync', () => {
      throw new Error('kaboom')
    })

    await expect(invoke('boom:sync')).rejects.toThrow('kaboom')

    const entry = readEntries(dir).at(-1) as {
      level: string
      message: string
      channel: string
      error: { name: string; message: string; stack: string }
    }
    expect(entry.level).toBe('error')
    expect(entry.message).toBe('IPC handler failed')
    expect(entry.channel).toBe('boom:sync')
    expect(entry.error.name).toBe('Error')
    expect(entry.error.message).toBe('kaboom')
    // Full fidelity, not just .message — the stack survives into the log line.
    expect(typeof entry.error.stack).toBe('string')
  })

  it('logs the channel and rejects when an async handler rejects', async () => {
    const dir = freshSessionDir()
    handle('boom:async', async () => {
      throw new Error('later')
    })

    await expect(invoke('boom:async')).rejects.toThrow('later')

    const entry = readEntries(dir).at(-1) as { channel: string; error: { message: string } }
    expect(entry.channel).toBe('boom:async')
    expect(entry.error.message).toBe('later')
  })

  it('rethrows the original error instance unchanged', async () => {
    freshSessionDir()
    const original = new Error('identity')
    handle('boom:identity', () => {
      throw original
    })
    await expect(invoke('boom:identity')).rejects.toBe(original)
  })
})
