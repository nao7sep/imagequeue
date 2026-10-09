import type { Worker } from 'node:worker_threads'
import path from 'node:path'
import createBackupWorker from './backup-worker?nodeWorker'
import { getDataDir } from '../config'
import { log } from '../logger'
import { currentRecordsContext } from '../records'
import type { BackupWorkerData, BackupWorkerMessage, BackupWorkerReport } from './backup-history'

// The main-process side of the backup history (data-backup-conventions). A
// protected save hands the exact bytes it just published to the backup thread
// and returns: recording is best effort, so a slow, stalled or broken history
// never delays a save or makes it fail, and a failure is only logged. What is
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

function report(value: BackupWorkerReport): void {
  if (value.type === 'open-failed') {
    log('warn', 'Backup history could not be opened; recording is off for this launch', { file: value.file, error: value.error })
  } else {
    log('warn', 'Backup history could not record a save', { file: value.path, error: value.error })
  }
}

function startWorker(): Worker | null {
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
 * Lets the backup thread apply what it was handed and close the store, for at
 * most `drainMs`; versions still pending after that are dropped. The next record
 * starts a new thread against the current storage root.
 */
export async function closeBackupStore(drainMs = 500): Promise<void> {
  const current = worker
  worker = null
  stopped = false
  if (!current) return
  const exited = new Promise<boolean>((resolve) => current.once('exit', () => resolve(true)))
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), drainMs) })
  current.postMessage({ type: 'close' } satisfies BackupWorkerMessage)
  const drained = await Promise.race([exited, deadline])
  clearTimeout(timer)
  if (!drained) {
    log('warn', 'Backup history did not finish in time; its pending versions were dropped', { drainMs })
    await current.terminate()
  }
}
