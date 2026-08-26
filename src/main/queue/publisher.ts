import { BrowserWindow } from 'electron'
import { refreshMainWindowMinimumSize } from '../main-window-layout'
import { log, serializeError } from '../logger'
import { buildControlState } from './control-state'
import { queueManager } from './queue-manager'
import type { QueueControlState } from '../../shared/types'

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
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('queue:controlState', controlState)
  }
  notifyControlListeners(controlState)
}

/** The one post-mutation path for queue state: renderer data, menu counts, and
 * native window constraints are one observable state and move together. */
export function publishQueueState(): void {
  const tasks = queueManager.getAllStoredTasks()
  const controlState = buildControlState()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('queue:updated', tasks)
    win.webContents.send('queue:controlState', controlState)
  }
  notifyControlListeners(controlState)
  refreshMainWindowMinimumSize()
}
