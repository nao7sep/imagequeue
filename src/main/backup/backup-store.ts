import type { Worker } from 'node:worker_threads'
import path from 'node:path'
import createBackupWorker from './backup-worker?nodeWorker'
import { getDataDir } from '../config'
import { log } from '../logger'
import { currentRecordsContext } from '../records'
import { raiseAppNotice } from '../app-notices'
import { backupsOffPresentation } from '../failure-presentation'
import type { BackupWorkerData, BackupWorkerMessage, BackupWorkerReport } from './backup-history'

// The main-process side of the backup history (data-backup-conventions). A
// protected save hands the exact bytes it just published to the backup thread
// and returns: recording is best effort, so a slow, stalled or broken history
// never delays a save or makes it fail. A history that cannot be opened is left
// as it is and the user is told backups are off; any other failure is logged. What is
// protected is decided at each write site (utils/atomic-write.ts `records`).
// There is no capture at launch, on a timer or at exit, and no restore path:
// recovery is manual, from backups.sqlite3.

// The store file under the resolved storage root, read when the thread starts
// so IMAGEQUEUE_DATA_DIR is honored once the environment is known.
function storeFile(): string {
  return path.join(getDataDir(), 'backups.sqlite3')
}

let worker: Worker | null = null
// A thread that failed stays failed for the launch; recording does not retry.
let stopped = false
let closing: Promise<void> | null = null

function report(value: BackupWorkerReport): void {
  if (value.type === 'open-failed') {
    log('warn', 'Backup history could not be opened; recording is off for this launch', { file: value.file, error: value.error })
    // The history is left as it is; the user is told backups are off.
    raiseAppNotice(backupsOffPresentation(value.file))
  } else {
    log('warn', 'Backup history could not record a save', { file: value.path, error: value.error })
  }
}

function startWorker(): Worker | null {
  if (closing) return null
  if (worker || stopped) return worker
  try {
    const data: BackupWorkerData = { file: storeFile(), sessionId: currentRecordsContext().launch }
    const started = createBackupWorker({ workerData: data })
    started.on('message', report)
    started.on('error', (error) => {
      log('warn', 'The backup thread failed; recording is off for this launch', { error: String(error) })
      if (worker === started) {
        worker = null
        stopped = true
      }
    })
    // The thread never keeps the process alive; quit drains it within a bound.
    started.unref()
    worker = started
  } catch (error) {
    log('warn', 'The backup thread could not start; recording is off for this launch', { error: String(error) })
    stopped = true
  }
  return worker
}

/** Hands the bytes a protected save just published at `absolutePath` to the history. Never throws. */
export function record(absolutePath: string, bytes: Uint8Array): void {
  try {
    const message: BackupWorkerMessage = { type: 'record', path: absolutePath, bytes }
    startWorker()?.postMessage(message)
  } catch (error) {
    log('warn', 'Backup history could not record a save', { file: absolutePath, error: String(error) })
  }
}

/**
 * Represents physical worker exit after the ordered close request. The quit
 * owner bounds the whole optional cleanup phase; this owner does not add a
 * second deadline or infer that pending versions have been discarded.
 */
export function closeBackupStore(): Promise<void> {
  if (closing) return closing
  const current = worker
  if (!current) { stopped = false; return Promise.resolve() }
  const exited = new Promise<void>((resolve) => current.once('exit', () => {
    if (worker === current) worker = null
    closing = null
    stopped = false
    resolve()
  }))
  closing = exited
  current.postMessage({ type: 'close' } satisfies BackupWorkerMessage)
  return exited
}
