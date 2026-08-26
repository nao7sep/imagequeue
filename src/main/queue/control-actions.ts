import { setQueuePaused } from '../backends/cancellation'
import { publishQueueControlState } from './publisher'

/** The one pause mutation, shared by renderer IPC and the native status menu. */
export function setQueuePausedAndPublish(paused: boolean): void {
  setQueuePaused(paused)
  publishQueueControlState()
}
