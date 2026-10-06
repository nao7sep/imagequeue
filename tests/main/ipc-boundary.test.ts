import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
import { NewerFormatError, StoreLeftInPlaceError } from '../../src/main/store-format'
import { freshRecordsRoot, readLog, removeRecordsRoots } from './records-fixture'

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
  removeRecordsRoots()
})

describe('handle (IPC boundary wrapper)', () => {
  it('returns the handler result and logs nothing for sync and async successes', async () => {
    const dir = freshRecordsRoot()
    handle('ok:sync', (_event, a: number, b: number) => a + b)
    handle('ok:async', async (_event, name: string) => `hi ${name}`)

    await expect(invoke('ok:sync', 2, 3)).resolves.toBe(5)
    await expect(invoke('ok:async', 'cat')).resolves.toBe('hi cat')

    expect(readLog(dir).some((entry) => entry.message === 'IPC handler failed')).toBe(false)
  })

  it('logs the channel + full error and still rejects when a sync handler throws', async () => {
    const dir = freshRecordsRoot()
    handle('boom:sync', () => {
      throw new Error('kaboom')
    })

    await expect(invoke('boom:sync')).rejects.toThrow('kaboom')

    const entry = readLog(dir).at(-1) as {
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
    const dir = freshRecordsRoot()
    handle('boom:async', async () => {
      throw new Error('later')
    })

    await expect(invoke('boom:async')).rejects.toThrow('later')

    const entry = readLog(dir).at(-1) as { channel: string; error: { message: string } }
    expect(entry.channel).toBe('boom:async')
    expect(entry.error.message).toBe('later')
  })

  it('rethrows the original error instance unchanged', async () => {
    freshRecordsRoot()
    const original = new Error('identity')
    handle('boom:identity', () => {
      throw original
    })
    await expect(invoke('boom:identity')).rejects.toBe(original)
  })
})

describe('a refusal by a store a newer version wrote', () => {
  it('names the file to the window in one notice per file, and still rejects every request', async () => {
    freshRecordsRoot()
    const send = vi.fn()
    const event = { sender: { send } }
    const listener = (channel: string, file: string) => {
      handle(channel, () => { throw new NewerFormatError(file, 2, 1) })
      return hoisted.registered.get(channel)!
    }
    const elaborators = listener('newer:elaborators', '/data/elaborators.json')
    const params = listener('newer:params', '/data/params.json')

    await expect(Promise.resolve(elaborators(event))).rejects.toThrow(NewerFormatError)
    await expect(Promise.resolve(elaborators(event))).rejects.toThrow(NewerFormatError)
    await expect(Promise.resolve(params(event))).rejects.toThrow(NewerFormatError)

    expect(send.mock.calls.map(([channel, notice]) => [channel, notice.message.values.path])).toEqual([
      ['app:notice', '/data/elaborators.json'],
      ['app:notice', '/data/params.json'],
    ])
  })
})

describe('a store that could be neither read nor set aside', () => {
  it('names the file it left in place, once, and still rejects every request', async () => {
    freshRecordsRoot()
    const send = vi.fn()
    const event = { sender: { send } }
    handle('halt:params', () => { throw new StoreLeftInPlaceError('/data/unmovable/params.json', { cause: new Error('EACCES') }) })
    const params = hoisted.registered.get('halt:params')!

    await expect(Promise.resolve(params(event))).rejects.toThrow(StoreLeftInPlaceError)
    await expect(Promise.resolve(params(event))).rejects.toThrow(StoreLeftInPlaceError)

    expect(send.mock.calls.map(([channel, notice]) => [channel, notice.title.key, notice.message.values.path])).toEqual([
      ['app:notice', 'notice.fileLeftInPlaceTitle', '/data/unmovable/params.json'],
    ])
  })
})
