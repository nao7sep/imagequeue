import { parentPort, workerData } from 'node:worker_threads'
import { openRecords, closeRecords, recordsDatabasePath, onRecordStored, readStored, write } from './records-storage'
import type { RecordsSearchWarning } from './records-query'

// The one owner of records.sqlite3: writes and the Records window's reads, in
// mailbox order on one connection.
openRecords(workerData.dataDir, workerData)
parentPort?.postMessage({ type: 'opened', available: recordsDatabasePath() !== null })
onRecordStored(() => parentPort?.postMessage({ type: 'stored' }))
parentPort?.on('message', (message) => {
  if (message.type === 'write') write(message.table, message.row)
  else if (message.type === 'flush') parentPort?.postMessage({ type: 'flushed', id: message.id })
  else if (message.type === 'read') {
    try {
      let warning: RecordsSearchWarning | undefined
      const value = readStored(message.read, (result) => { warning = result })
      parentPort?.postMessage({ type: 'read', id: message.id, value, ...(warning ? { warning } : {}) })
    } catch (error) {
      parentPort?.postMessage({ type: 'read', id: message.id, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) })
    }
  }
  else if (message.type === 'close') { closeRecords(); parentPort?.close() }
})
