import type { Task } from './types'

/** Main-window geometry and renderer rows share the same visibility rule. */
export function isQueueTaskVisible(task: Pick<Task, 'status'>, showKeptImages: boolean): boolean {
  return showKeptImages || task.status !== 'kept'
}
