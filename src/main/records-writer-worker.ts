import { parentPort, workerData } from 'node:worker_threads'
import { openRecords, closeRecords, recordsDatabasePath, onRecordStored, write } from './records-storage'

openRecords(workerData.dataDir, workerData)
parentPort?.postMessage({ type: 'opened', available: recordsDatabasePath() !== null })
onRecordStored(() => parentPort?.postMessage({ type: 'stored' }))
parentPort?.on('message', (message) => {
  if (message.type === 'write') {
    write(message.table, message.row)
    parentPort?.postMessage({ type: 'written', recordId: message.recordId })
  }
  else if (message.type === 'flush') parentPort?.postMessage({ type: 'flushed', id: message.id })
  else if (message.type === 'close') { closeRecords(); parentPort?.close() }
})
