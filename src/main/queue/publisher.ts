import { broadcastPresentation } from '../presentation'
import { refreshMainWindowMinimumSize } from '../main-window-layout'
import { log, serializeError } from '../logger'
import { buildControlState } from './control-state'
import { queueManager } from './queue-manager'
import type { QueueControlState } from '../../shared/types'
import type { AppNotice } from '../../shared/app-notice'

type QueueControlListener = (state: QueueControlState) => void
const controlListeners = new Set<QueueControlListener>()

function notifyControlListeners(state: QueueControlState): void {
  for (const listener of controlListeners) {
    try {
      listener(state)
    } catch (err) {
      // A native-menu presentation failure must never turn a successful queue
      // mutation into a failed IPC request.
      log('warn', 'Queue control presentation listener failed', { error: serializeError(err) })
    }
  }
}

export function subscribeQueueControlState(listener: QueueControlListener): () => void {
  controlListeners.add(listener)
  try {
    listener(buildControlState())
  } catch (err) {
    log('warn', 'Queue control presentation listener failed', { error: serializeError(err) })
  }
  return () => { controlListeners.delete(listener) }
}

export function publishQueueControlState(): void {
  const controlState = buildControlState()
  broadcastPresentation('queue:controlState', controlState)
  notifyControlListeners(controlState)
}

/** The one post-mutation path for queue state: renderer data, menu counts, and
 * native window constraints are one observable state and move together. */
export function publishQueueState(): void {
  const tasks = queueManager.getAllStoredTasks()
  const controlState = buildControlState()
  broadcastPresentation('queue:updated', tasks)
  broadcastPresentation('queue:controlState', controlState)
  notifyControlListeners(controlState)
  try {
    refreshMainWindowMinimumSize()
  } catch (error) {
    log('warn', 'Window geometry presentation failed', { error: serializeError(error) })
  }
}

/** An app-wide notice from queue work no renderer request is waiting on. */
export function publishAppNotice(notice: AppNotice): void {
  broadcastPresentation('app:notice', notice)
}
