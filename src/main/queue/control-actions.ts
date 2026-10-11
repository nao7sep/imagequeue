import { setQueuePaused } from '../backends/cancellation'
import { publishQueueControlState } from './publisher'
import { resetStorageFailureNotice } from './storage-failure'

/** The one pause mutation, shared by renderer IPC and the native status menu. */
export function setQueuePausedAndPublish(paused: boolean): void {
  if (!paused) resetStorageFailureNotice()
  setQueuePaused(paused)
  publishQueueControlState()
}
