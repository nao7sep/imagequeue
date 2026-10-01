import createArchiveWorker from './archive-worker?nodeWorker'
import { getDataDir } from '../config'
import { getArchivedStores } from '../config/storage-root'
import { log, serializeError } from '../logger'
import { clearAbandonedRun, type ArchiveResult } from './archive-engine'
import { waitForAllSettledWithin } from '../utils/bounded-wait'

// One launch/quit owner, with a bound independent of a stalled database or disk.
async function runSession(action: 'begin' | 'finish'): Promise<void> {
  try {
    const root = getDataDir()
    const worker = createArchiveWorker({ workerData: { action, root, stores: getArchivedStores(root) } })
    let stopped: Promise<unknown> = Promise.resolve()
    let deadlineEnded = false
    const result = await new Promise<ArchiveResult>((resolve) => {
      let settled = false
      const finish = (result: ArchiveResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        stopped = worker.terminate().catch((error) => log('warn', 'Archive worker termination failed', { error: serializeError(error) }))
        resolve(result)
      }
      const timer = setTimeout(() => {
        deadlineEnded = true
        finish({ warnings: [{ path: root, error: serializeError(new Error('Archive deadline exceeded')) }] })
      }, 5000)
      worker.once('message', finish)
      worker.once('error', (error) => finish({ warnings: [{ path: root, error: serializeError(error) }] }))
      worker.once('exit', (code) => {
        if (!settled) finish({ warnings: [{ path: root, error: serializeError(new Error(`Archive worker exited before completion (${code})`)) }] })
      })
    })
    if (result.warnings.length) log('warn', 'Binary-store archive incomplete', { failures: result.warnings })
    if (deadlineEnded) {
      // Once the worker has stopped, its lock and temporary files go, within a bound of their own.
      const cleared = stopped.then(() => clearAbandonedRun(root))
        .catch((error) => log('warn', 'Archive cleanup failed', { error: serializeError(error) }))
      if (!await waitForAllSettledWithin([cleared], 1000)) log('warn', 'Archive cleanup did not finish in time')
    }
  } catch (error) {
    log('warn', 'Binary-store archive failed', { error: serializeError(error) })
  }
}

let active: Promise<void> | null = null
export function archiveSession(action: 'begin' | 'finish'): Promise<void> {
  const pending = (active ?? Promise.resolve()).then(() => runSession(action))
  active = pending
  return pending.finally(() => { if (active === pending) active = null })
}
