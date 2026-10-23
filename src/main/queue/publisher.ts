import type { WebContents } from 'electron'
import type { QueueSnapshot, QueueUpdate } from '../../shared/queue-updates'
import { broadcastPresentation } from '../presentation'
import { refreshMainWindowMinimumSize } from '../main-window-layout'
import { log, serializeError } from '../logger'
import { buildControlState } from './control-state'
import { queueManager } from './queue-manager'
import type { QueueControlState } from '../../shared/types'
import type { AppNotice } from '../../shared/app-notice'

// Only windows that consume queue rows receive them. A renderer obtains a
// fresh snapshot on subscribe/resync; revision gaps never guess missing edits.
const consumers = new Map<WebContents, () => void>()
let publishedRevision = 0

export function unsubscribeQueue(sender: WebContents): void {
  consumers.get(sender)?.()
}

export function getQueueSnapshot(sender: WebContents): QueueSnapshot {
  if (!consumers.has(sender)) {
    const remove = (): void => {
      consumers.delete(sender)
      sender.removeListener('destroyed', remove)
      sender.removeListener('render-process-gone', remove)
    }
    consumers.set(sender, remove)
    sender.once('destroyed', remove)
    sender.once('render-process-gone', remove)
  }
  return { kind: 'snapshot', revision: queueManager.currentRevision, tasks: queueManager.getAllStoredTasks() }
}

function publishTaskChanges(): void {
  const changes = queueManager.captureChanges('presentation')
  if (changes.revision === publishedRevision) return
  const update: QueueUpdate = changes.reset
    ? { kind: 'snapshot', revision: changes.revision, tasks: changes.reset }
    : { kind: 'delta', baseRevision: publishedRevision, revision: changes.revision, upserts: changes.upserts, removed: changes.removed }
  for (const sender of consumers.keys()) {
    try { sender.send('queue:updated', update) } catch (error) {
      log('warn', 'Queue presentation failed', { error: serializeError(error) })
    }
  }
  queueManager.ackChanges('presentation', changes.revision)
  publishedRevision = changes.revision
}

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
  const controlState = buildControlState()
  publishTaskChanges()
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
