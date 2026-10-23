import type { BackendId, TaskStatus } from '../../../shared/types'

// Whether a task row should auto-scroll itself into view on this status change.
// True only on a genuine transition INTO 'completed' — a freshly generated
// image the user should be drawn to. An item that mounts already completed or
// kept (app launch restoring stored tasks, or revealing kept images), or that
// flips to 'kept', is NOT a fresh completion and must leave the scroll alone.
export function isFreshCompletion(prevStatus: TaskStatus, status: TaskStatus): boolean {
  return status === 'completed' && prevStatus !== 'completed'
}

// Selection owns navigation; each column owns its measured scroll geometry.
export const TASK_REVEAL_EVENT = 'imagequeue:reveal-task'
export interface TaskRevealRequest {
  backend: BackendId
  taskId: string
}

export function requestTaskReveal(backend: BackendId, taskId: string): void {
  window.dispatchEvent(new CustomEvent<TaskRevealRequest>(TASK_REVEAL_EVENT, { detail: { backend, taskId } }))
}
