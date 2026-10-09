import { EventEmitter } from 'node:events'
import { vi } from 'vitest'

// Unit tests execute the actual storage adapters in-process. Runtime thread
// responsiveness is checked separately against the built worker entries.
vi.mock('../../src/main/records-writer-worker?nodeWorker', async () => {
  const storage = await import('../../src/main/records-storage')
  return { default: ({ workerData }: { workerData: { dataDir: string } }) => {
    const thread = new EventEmitter()
    storage.openRecords(workerData.dataDir)
    storage.onRecordStored(() => thread.emit('message', { type: 'stored' }))
    let opened = false
    return Object.assign(thread, {
      postMessage: (message: { type: string; id?: number; recordId?: number; table: Parameters<typeof storage.write>[0]; row: Parameters<typeof storage.write>[1] }) => {
        if (!opened) { opened = true; thread.emit('message', { type: 'opened', available: storage.recordsDatabasePath() !== null }) }
        if (message.type === 'write') { storage.write(message.table, message.row); thread.emit('message', { type: 'written', recordId: message.recordId }) }
        else if (message.type === 'flush') thread.emit('message', { type: 'flushed', id: message.id })
        else if (message.type === 'close') { storage.closeRecords(); thread.emit('exit', 0) }
      },
      unref: () => thread,
      terminate: async () => { storage.closeRecords(); thread.emit('exit', 1); return 1 },
    })
  } }
})

vi.mock('../../src/main/concepts/concept-worker?nodeWorker', async () => {
  const database = await import('../../src/main/concepts/concept-database')
  const { serializeError } = await import('../../src/shared/serialize-error')
  return { default: ({ workerData }: { workerData: { dataDir: string } }) => {
    const thread = new EventEmitter()
    database.initializeConceptStore(workerData.dataDir, (level, message, fields) => thread.emit('message', { type: 'log', level, message, fields }))
    return Object.assign(thread, {
      postMessage: ({ id, op, args }: { id: number; op: keyof typeof database; args: unknown[] }) => {
        try {
          const value = (database[op] as (...args: unknown[]) => unknown)(...args)
          thread.emit('message', { id, value, paths: database.drainSetAsideConceptStorePaths() })
        } catch (error) {
          thread.emit('message', { id, error: serializeError(error), paths: database.drainSetAsideConceptStorePaths() })
        }
      },
      unref: () => thread,
      terminate: async () => { database.closeConceptStore(); thread.emit('exit', 0); return 0 },
    })
  } }
})
