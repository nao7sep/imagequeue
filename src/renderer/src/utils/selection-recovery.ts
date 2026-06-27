import type { BackendId } from '../../../shared'

// The pure selection-recovery algorithm behind the queue: given the pre-removal
// task lists and which task is being removed, pick the selection to fall back to.
// The DOM geometry that breaks ties across columns is injected as `centerOf`, so
// the column-walking logic is testable with no DOM. Structurally identical to
// SelectionContext's `Selection`, so the two interoperate without an import cycle.

export interface RecoverySelection {
  backend: BackendId
  taskId: string
}

export interface TaskRef {
  id: string
}

/**
 * General recovery order: the next task in the same column, then the previous in
 * the same column, then the nearest task in the adjacent columns (rightward
 * first, then leftward) by vertical nearness to the removed row. `centerOf`
 * returns a task row's vertical center, or null when it has no element; when the
 * removed row itself has no center, each column falls back to its first task.
 */
export function nextSelectionAfterRemoval(
  target: RecoverySelection,
  lists: Partial<Record<BackendId, TaskRef[]>>,
  visibleBackends: BackendId[],
  centerOf: (taskId: string) => number | null
): RecoverySelection | null {
  const list = lists[target.backend] ?? []
  const idx = list.findIndex((t) => t.id === target.taskId)

  // 1. Same column, downward
  if (idx >= 0 && idx + 1 < list.length) {
    return { backend: target.backend, taskId: list[idx + 1].id }
  }
  // 2. Same column, upward
  if (idx > 0) {
    return { backend: target.backend, taskId: list[idx - 1].id }
  }

  // 3 & 4. Adjacent columns by visual nearness
  const removedCy = centerOf(target.taskId)
  const colIdx = visibleBackends.indexOf(target.backend)
  if (colIdx < 0) return null

  const findNearestInCol = (b: BackendId): RecoverySelection | null => {
    const colTasks = lists[b]
    if (!colTasks || colTasks.length === 0) return null
    if (removedCy === null) {
      return { backend: b, taskId: colTasks[0].id }
    }
    let bestId: string | null = null
    let bestDist = Infinity
    for (const t of colTasks) {
      const cy = centerOf(t.id)
      if (cy === null) continue
      const d = Math.abs(cy - removedCy)
      if (d < bestDist) {
        bestDist = d
        bestId = t.id
      }
    }
    return { backend: b, taskId: bestId ?? colTasks[0].id }
  }

  // 3. Rightward
  for (let i = colIdx + 1; i < visibleBackends.length; i++) {
    const next = findNearestInCol(visibleBackends[i])
    if (next) return next
  }
  // 4. Leftward
  for (let i = colIdx - 1; i >= 0; i--) {
    const next = findNearestInCol(visibleBackends[i])
    if (next) return next
  }
  return null
}
