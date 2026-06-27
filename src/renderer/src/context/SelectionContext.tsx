import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { shouldDeleteToTrash, type BackendId, type Task } from '../../../shared'
import { useQueue } from './QueueContext'
import { useSettings } from './SettingsContext'
import { useConfirm } from './ConfirmContext'
import { getVisibleBackends } from '../utils/visibleBackends'
import { nextSelectionAfterRemoval } from '../utils/selection-recovery'

export interface Selection {
  backend: BackendId
  taskId: string
}

export type NavDirection = 'up' | 'down' | 'left' | 'right'

interface SelectionContextValue {
  selection: Selection | null
  selectedTask: Task | null
  select: (backend: BackendId, taskId: string) => void
  clear: () => void
  navigate: (dir: NavDirection) => void
  selectEdge: (backend: BackendId, edge: 'first' | 'last') => void
  removeTask: (backend: BackendId, taskId: string) => Promise<void>
  restoreTask: (backend: BackendId, taskId: string) => Promise<void>
  deleteTask: (backend: BackendId, taskId: string) => Promise<void>
  removeSelected: () => Promise<void>
  restoreSelected: () => Promise<void>
  deleteSelected: () => Promise<void>
}

const SelectionContext = createContext<SelectionContextValue | null>(null)

// Resolve a task's row element by its data-task-id (set on every TaskItem).
function getTaskElement(taskId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(taskId)}"]`)
}

// True when DOM focus currently sits on a task row inside one of the queue's
// `.task-list` listboxes. Drives the never-steal-focus rule: auto-select,
// recovery, and the keyboard-nav focus-follow only move DOM focus when focus
// already lives in the queue.
function focusIsInTaskList(): boolean {
  const active = document.activeElement
  return active instanceof HTMLElement && !!active.closest('.task-list')
}

export function SelectionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { tasks, restoreTask: restoreQueuedTask } = useQueue()
  const { settings } = useSettings()
  const confirm = useConfirm()

  const [selection, setSelection] = useState<Selection | null>(null)
  const selectionRef = useRef<Selection | null>(null)
  selectionRef.current = selection

  const tasksRef = useRef(tasks)
  tasksRef.current = tasks

  // Tracks the last time the user did anything that affects selection
  // (click, keyboard nav, remove, delete, explicit clear). Auto-preview
  // checks this before stealing the selection on a fresh completion.
  const lastActionRef = useRef<number>(0)

  // After a keyboard remove/delete drops the focused row, focus has fallen to the
  // page body and the column would lose its tab stop. This holds the id we should
  // re-focus once the list re-renders with the recovered selection. Set only when
  // the gesture came from within a `.task-list`.
  const pendingFocusIdRef = useRef<string | null>(null)

  const visibleBackends = useMemo(() => getVisibleBackends(), [])

  const selectedTask = useMemo<Task | null>(() => {
    if (!selection) return null
    const list = tasks[selection.backend]
    return list?.find((t) => t.id === selection.taskId) ?? null
  }, [selection, tasks])

  // ---- Internal helpers --------------------------------------------------

  const setSelectionInternal = useCallback(
    (next: Selection | null, opts: { userInitiated: boolean }): void => {
      if (opts.userInitiated) lastActionRef.current = Date.now()
      setSelection(next)
    },
    []
  )

  const select = useCallback((backend: BackendId, taskId: string): void => {
    setSelectionInternal({ backend, taskId }, { userInitiated: true })
  }, [setSelectionInternal])

  const clear = useCallback((): void => {
    setSelectionInternal(null, { userInitiated: true })
  }, [setSelectionInternal])

  // For fallback after removal: compute next selection BEFORE removing. The pure
  // recovery algorithm (same-column next/prev, then nearest in an adjacent column)
  // lives in selection-recovery.ts; this wrapper supplies the live task lists and
  // the DOM geometry — a row's vertical center, measured before the row is gone.
  const computeNextAfterRemoval = (target: Selection): Selection | null =>
    nextSelectionAfterRemoval(target, tasksRef.current, visibleBackends, (taskId) => {
      const el = getTaskElement(taskId)
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return rect.top + rect.height / 2
    })

  // If the task being removed is the currently selected one, the fallback
  // picks the next one. Otherwise selection is left alone. When the gesture came
  // from within the queue, arm a focus-follow so the recovered row reclaims the
  // column's tab stop after the list re-renders (never-steal-focus: only when
  // focus was already in the queue).
  const transitionSelectionForRemoval = (backend: BackendId, taskId: string): void => {
    const sel = selectionRef.current
    if (!sel || sel.backend !== backend || sel.taskId !== taskId) return
    const next = computeNextAfterRemoval({ backend, taskId })
    if (focusIsInTaskList()) pendingFocusIdRef.current = next?.taskId ?? null
    setSelectionInternal(next, { userInitiated: true })
  }

  const removeTask = useCallback(async (backend: BackendId, taskId: string): Promise<void> => {
    const task = tasksRef.current[backend]?.find((t) => t.id === taskId)
    if (!task) return
    if (task.status === 'generating') return

    const general = (settings?.general as { confirm_remove?: boolean } | undefined)
    if (general?.confirm_remove) {
      const keepingCompleted = task.status === 'completed'
      const ok = await confirm({
        title: keepingCompleted ? 'Keep Image' : 'Remove Task',
        message: keepingCompleted
          ? 'Mark this completed image as kept and take it out of the active list?'
          : 'Remove this task from the queue?',
        confirmLabel: keepingCompleted ? 'Keep' : 'Remove'
      })
      if (!ok) return
    }

    // Always advance — the gesture means this item no longer needs active
    // review. When showKeptImages is on, the kept task stays in the list as
    // `kept` and computeNextAfterRemoval still picks the correct neighbor
    // because it runs before the IPC against the pre-update task list.
    transitionSelectionForRemoval(backend, taskId)
    await window.electronAPI.removeTask(backend, taskId)
  }, [confirm, settings, setSelectionInternal])

  const deleteTask = useCallback(async (backend: BackendId, taskId: string): Promise<void> => {
    const task = tasksRef.current[backend]?.find((t) => t.id === taskId)
    if (!task) return
    if (task.status !== 'completed' && task.status !== 'kept') return

    const general = (settings?.general as { confirm_delete?: boolean; delete_to_trash?: unknown } | undefined)
    if (general?.confirm_delete) {
      const toTrash = shouldDeleteToTrash(general.delete_to_trash)
      const ok = await confirm({
        title: 'Delete Task',
        message: toTrash
          ? 'Delete this task and move its files to the Trash?'
          : 'Delete this task and permanently delete its files?',
        confirmLabel: 'Delete',
        danger: true
      })
      if (!ok) return
    }

    transitionSelectionForRemoval(backend, taskId)
    await window.electronAPI.deleteWithFiles(backend, taskId)
  }, [confirm, settings, setSelectionInternal])

  const restoreTask = useCallback(async (backend: BackendId, taskId: string): Promise<void> => {
    const task = tasksRef.current[backend]?.find((t) => t.id === taskId)
    if (!task || task.status !== 'kept') return
    lastActionRef.current = Date.now()
    await restoreQueuedTask(backend, taskId)
  }, [restoreQueuedTask])

  const removeSelected = useCallback(async (): Promise<void> => {
    const sel = selectionRef.current
    if (!sel) return
    await removeTask(sel.backend, sel.taskId)
  }, [removeTask])

  const deleteSelected = useCallback(async (): Promise<void> => {
    const sel = selectionRef.current
    if (!sel) return
    await deleteTask(sel.backend, sel.taskId)
  }, [deleteTask])

  const restoreSelected = useCallback(async (): Promise<void> => {
    const sel = selectionRef.current
    if (!sel) return
    await restoreTask(sel.backend, sel.taskId)
  }, [restoreTask])

  // ---- Navigation -------------------------------------------------------

  // Move the keyboard selection. Owns all four arrows for the queue board, which
  // is the convention's multi-column "grid" sibling of the listbox: Up/Down move
  // within the focused column; Left/Right move to the nearest task in the
  // adjacent column by vertical geometry (the cross-column switch the user relies
  // on), following focus to that column. Activation follows focus — selection
  // drives the detail/preview directly.
  //
  // Two call sites: the focused column's keydown (focus lives in a `.task-list`,
  // so we move DOM focus to the new row — the roving tab stop follows the
  // selection) and the fullscreen viewer bridge (the main window's list is not
  // focused, so we only update selection and scroll, never grabbing focus). The
  // focusIsInTaskList guard distinguishes the two without a flag.
  const navigate = useCallback((dir: NavDirection): void => {
    const sel = selectionRef.current
    const map = tasksRef.current
    if (!sel) return

    const commit = (backend: BackendId, taskId: string): void => {
      setSelectionInternal({ backend, taskId }, { userInitiated: true })
      const followFocus = focusIsInTaskList()
      requestAnimationFrame(() => {
        const el = getTaskElement(taskId)
        el?.scrollIntoView({ block: 'nearest' })
        if (followFocus) el?.focus()
      })
    }

    if (dir === 'up' || dir === 'down') {
      const list = map[sel.backend]
      const idx = list.findIndex((t) => t.id === sel.taskId)
      if (idx < 0) return
      const nextIdx = dir === 'down' ? idx + 1 : idx - 1
      if (nextIdx < 0 || nextIdx >= list.length) return
      commit(sel.backend, list[nextIdx].id)
      return
    }

    const colIdx = visibleBackends.indexOf(sel.backend)
    if (colIdx < 0) return
    const step = dir === 'right' ? 1 : -1
    const selEl = getTaskElement(sel.taskId)
    const selRect = selEl?.getBoundingClientRect()
    const cy = selRect ? selRect.top + selRect.height / 2 : null

    for (let i = colIdx + step; i >= 0 && i < visibleBackends.length; i += step) {
      const b = visibleBackends[i]
      const colTasks = map[b]
      if (!colTasks || colTasks.length === 0) continue
      let bestId: string | null = null
      if (cy === null) {
        bestId = colTasks[0].id
      } else {
        let bestDist = Infinity
        for (const t of colTasks) {
          const el = getTaskElement(t.id)
          if (!el) continue
          const r = el.getBoundingClientRect()
          const elCy = r.top + r.height / 2
          const d = Math.abs(elCy - cy)
          if (d < bestDist) {
            bestDist = d
            bestId = t.id
          }
        }
        if (!bestId) bestId = colTasks[0].id
      }
      commit(b, bestId)
      return
    }
  }, [visibleBackends, setSelectionInternal])

  // Home/End within a column: select the first/last task of that column and
  // follow focus to it. Local to the queue board (the viewer has no equivalent).
  const selectEdge = useCallback((backend: BackendId, edge: 'first' | 'last'): void => {
    const list = tasksRef.current[backend]
    if (!list || list.length === 0) return
    const taskId = edge === 'first' ? list[0].id : list[list.length - 1].id
    setSelectionInternal({ backend, taskId }, { userInitiated: true })
    requestAnimationFrame(() => {
      const el = getTaskElement(taskId)
      el?.scrollIntoView({ block: 'nearest' })
      el?.focus()
    })
  }, [setSelectionInternal])

  // ---- Reconcile selection when tasks change ----------------------------

  // If the selected task has disappeared (e.g. removed externally), clear it.
  // Don't bump lastActionRef — the user didn't do anything.
  useEffect(() => {
    if (!selection) return
    const list = tasks[selection.backend]
    if (!list?.some((t) => t.id === selection.taskId)) {
      setSelection(null)
    }
  }, [tasks, selection])

  // After a keyboard remove/delete re-renders the list, the focused row is gone
  // and focus dropped to the page body. Reclaim the column's tab stop by focusing
  // the recovered row — but only if focus is still nowhere useful (body), so we
  // never yank focus away from wherever the user has since moved it.
  //
  // Keyed on `tasks` ONLY, never `selection`: the remove gesture moves the
  // selection to the recovered row *before* awaiting the IPC that actually drops
  // the old row, so a `selection` dependency would run this on that intermediate
  // render — while the old row is still mounted and focused (activeElement is not
  // body) — and prematurely clear the pending focus. By the time the row truly
  // unmounts and focus falls to body there would be nothing left to restore,
  // stranding focus on body and silencing every list keyboard action. Reacting
  // only to the removal re-render (the `tasks` change) lands focus on the
  // recovered row.
  useEffect(() => {
    const targetId = pendingFocusIdRef.current
    if (targetId === null) return
    if (document.activeElement !== null && document.activeElement !== document.body) {
      pendingFocusIdRef.current = null
      return
    }
    const el = getTaskElement(targetId)
    if (el) {
      el.scrollIntoView({ block: 'nearest' })
      el.focus()
      pendingFocusIdRef.current = null
    }
  }, [tasks])

  // ---- Auto-select on completion ----------------------------------------

  const prevTasksRef = useRef<Record<BackendId, Task[]> | null>(null)

  useEffect(() => {
    const prev = prevTasksRef.current
    prevTasksRef.current = tasks
    if (!prev) return // first render — nothing to compare

    const idleSeconds = ((settings?.general as { auto_preview_idle_seconds?: number } | undefined)?.auto_preview_idle_seconds) ?? 0
    if (!idleSeconds || idleSeconds <= 0) return

    const idleEnough = Date.now() - lastActionRef.current >= idleSeconds * 1000
    if (!idleEnough) return

    // Find newly-completed tasks across all backends.
    let bestBackend: BackendId | null = null
    let bestTaskId: string | null = null
    let bestTime = -Infinity

    for (const backend of Object.keys(tasks) as BackendId[]) {
      const curr = tasks[backend]
      const prevList = prev[backend] ?? []
      const prevById = new Map(prevList.map((t) => [t.id, t]))
      for (const t of curr) {
        if (t.status !== 'completed') continue
        const before = prevById.get(t.id)
        if (before && before.status === 'completed') continue // already completed
        const ts = t.completedAt ? new Date(t.completedAt).getTime() : Date.now()
        if (ts > bestTime) {
          bestTime = ts
          bestBackend = backend
          bestTaskId = t.id
        }
      }
    }

    if (bestBackend && bestTaskId) {
      // Internal auto-select: do NOT bump lastActionRef, so a stream of
      // completions during continued idleness keeps refreshing the preview.
      // Selection only — never grabs DOM focus (the user is idle/elsewhere).
      setSelectionInternal({ backend: bestBackend, taskId: bestTaskId }, { userInitiated: false })
    }
  }, [tasks, settings, setSelectionInternal])

  return (
    <SelectionContext.Provider value={{ selection, selectedTask, select, clear, navigate, selectEdge, removeTask, restoreTask, deleteTask, removeSelected, restoreSelected, deleteSelected }}>
      {children}
    </SelectionContext.Provider>
  )
}

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext)
  if (!ctx) throw new Error('useSelection must be used within SelectionProvider')
  return ctx
}
