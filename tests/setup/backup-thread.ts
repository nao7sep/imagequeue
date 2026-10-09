import { EventEmitter } from 'node:events'
import { vi } from 'vitest'

// Vitest cannot build the `?nodeWorker` entry that runs the backup thread, so
// the thread runs in-process here: the same writer handles each message, at
// once, in order. A test of what happens while the thread is slow or stuck
// mocks the entry itself and restores this one afterwards.
export async function inProcessBackupThread() {
  const { createBackupWriter } = await import('../../src/main/backup/backup-history')
  type Data = Parameters<typeof createBackupWriter>[0]
  type Message = Parameters<ReturnType<typeof createBackupWriter>>[0]
  return {
    default: ({ workerData }: { workerData: Data }) => {
      const thread = new EventEmitter()
      let ended = false
      const end = (code: number): void => {
        if (ended) return
        ended = true
        thread.emit('exit', code)
      }
      const write = createBackupWriter(workerData, (report) => thread.emit('message', report))
      return Object.assign(thread, {
        postMessage: (message: Message) => {
          if (!ended && write(message)) end(0)
        },
        unref: () => thread,
        terminate: async () => {
          write({ type: 'close' })
          end(1)
          return 1
        },
      })
    },
  }
}

vi.mock('../../src/main/backup/backup-worker?nodeWorker', inProcessBackupThread)
