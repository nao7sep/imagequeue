import createArchiveWorker from './archive-worker?nodeWorker'
import { getDataDir } from '../config'
import { getArchivedStores } from '../config/storage-root'
import { log, serializeError } from '../logger'
import type { ArchiveResult } from './archive-engine'

// One launch/quit owner, with a bound independent of a stalled database or disk.
async function runSession(action: 'begin' | 'finish'): Promise<void> {
  try {
    const root = getDataDir()
    const worker = createArchiveWorker({ workerData: { action, root, stores: getArchivedStores(root) } })
    const result = await new Promise<ArchiveResult>((resolve) => {
      let settled = false
      const finish = (result: ArchiveResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        void worker.terminate().catch((error) => log('warn', 'Archive worker termination failed', { error: serializeError(error) }))
        resolve(result)
      }
      const timer = setTimeout(() => finish({ warnings: [{ path: root, error: serializeError(new Error('Archive deadline exceeded')) }] }), 5000)
      worker.once('message', finish)
      worker.once('error', (error) => finish({ warnings: [{ path: root, error: serializeError(error) }] }))
      worker.once('exit', (code) => {
        if (!settled) finish({ warnings: [{ path: root, error: serializeError(new Error(`Archive worker exited before completion (${code})`)) }] })
      })
    })
    if (result.warnings.length) log('warn', 'Binary-store archive incomplete', { failures: result.warnings })
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
