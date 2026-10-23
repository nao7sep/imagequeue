import type { BackendId, Task } from './types'

export interface QueueSnapshot {
  kind: 'snapshot'
  revision: number
  tasks: Record<BackendId, Task[]>
}
export interface QueueDelta {
  kind: 'delta'
  baseRevision: number
  revision: number
  upserts: Task[]
  removed: { backend: BackendId; id: string }[]
}
export type QueueUpdate = QueueSnapshot | QueueDelta

/** Existing rows retain their position; newly enqueued rows prepend in enqueue
 * order. Untouched backend arrays and task objects retain their identity. */
export function applyQueueDelta(tasks: Record<BackendId, Task[]>, delta: QueueDelta): Record<BackendId, Task[]> {
  const next = { ...tasks }
  const backends = new Set([...delta.upserts.map(task => task.backend), ...delta.removed.map(task => task.backend)])
  for (const backend of backends) {
    const changed = new Map(delta.upserts.filter(task => task.backend === backend).map(task => [task.id, task]))
    const removed = new Set(delta.removed.filter(task => task.backend === backend).map(task => task.id))
    const rows: Task[] = []
    for (const task of tasks[backend]) {
      if (!removed.has(task.id)) rows.push(changed.get(task.id) ?? task)
      changed.delete(task.id)
    }
    next[backend] = [...changed.values()].reverse().concat(rows)
  }
  return next
}
