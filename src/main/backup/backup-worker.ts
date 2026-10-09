import { parentPort, workerData } from 'node:worker_threads'
import { createBackupWriter, type BackupWorkerData, type BackupWorkerMessage } from './backup-history'

// The one owner of backups.sqlite3, on its own thread so a slow or stalled
// history never holds up a save or the main process. Saves arrive in the order
// they happened and are applied one at a time.

const write = createBackupWriter(workerData as BackupWorkerData, (report) => parentPort?.postMessage(report))

parentPort?.on('message', (message: BackupWorkerMessage) => {
  if (write(message)) parentPort?.close()
})
