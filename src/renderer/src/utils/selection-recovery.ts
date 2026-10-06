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

/** The task in column `b` whose row is vertically nearest to `cy`; the first
 *  task when there is no center to compare against; null for an empty column. */
function nearestInColumn(
  b: BackendId,
  lists: Partial<Record<BackendId, TaskRef[]>>,
  cy: number | null,
  centerOf: (taskId: string) => number | null
): RecoverySelection | null {
  const colTasks = lists[b]
  if (!colTasks || colTasks.length === 0) return null
  if (cy === null) return { backend: b, taskId: colTasks[0].id }
  let bestId: string | null = null
  let bestDist = Infinity
  for (const t of colTasks) {
    const tcy = centerOf(t.id)
    if (tcy === null) continue
    const d = Math.abs(tcy - cy)
    if (d < bestDist) {
      bestDist = d
      bestId = t.id
    }
  }
  return { backend: b, taskId: bestId ?? colTasks[0].id }
}

/**
 * Left and Right on the queue board: the nearest task, by its row's vertical
 * center, in the next non-empty column in that direction, skipping empty
 * columns. Null at the edge of the board. Shared by the lists and the views that
 * hand their arrows to the main window, which pick by the same on-screen position.
 */
export function nearestInAdjacentColumn(
  current: RecoverySelection,
  lists: Partial<Record<BackendId, TaskRef[]>>,
  visibleBackends: BackendId[],
  dir: 'left' | 'right',
  centerOf: (taskId: string) => number | null
): RecoverySelection | null {
  const colIdx = visibleBackends.indexOf(current.backend)
  if (colIdx < 0) return null
  const step = dir === 'right' ? 1 : -1
  const cy = centerOf(current.taskId)
  for (let i = colIdx + step; i >= 0 && i < visibleBackends.length; i += step) {
    const next = nearestInColumn(visibleBackends[i], lists, cy, centerOf)
    if (next) return next
  }
  return null
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

  const findNearestInCol = (b: BackendId): RecoverySelection | null =>
    nearestInColumn(b, lists, removedCy, centerOf)

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
