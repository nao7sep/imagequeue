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
import { BACKEND_IDS_IN_UI_ORDER, shouldDeleteToTrash, type BackendId, type Task } from '../../../shared'
import { useQueue } from './QueueContext'
import { useSettings } from './SettingsContext'
import { useConfirm } from './ConfirmContext'

function getVisibleBackends(): BackendId[] {
  const isMac = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin'
  return isMac ? BACKEND_IDS_IN_UI_ORDER : BACKEND_IDS_IN_UI_ORDER.filter((b) => b !== 'drawthings')
}

export interface Selection {
  backend: BackendId
  taskId: string
}

interface SelectionContextValue {
  selection: Selection | null
  selectedTask: Task | null
  select: (backend: BackendId, taskId: string) => void
  clear: () => void
  removeTask: (backend: BackendId, taskId: string) => Promise<void>
  restoreTask: (backend: BackendId, taskId: string) => Promise<void>
  deleteTask: (backend: BackendId, taskId: string) => Promise<void>
  removeSelected: () => Promise<void>
  restoreSelected: () => Promise<void>
  deleteSelected: () => Promise<void>
}

const SelectionContext = createContext<SelectionContextValue | null>(null)

export function SelectionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { tasks, showKeptImages, restoreTask: restoreQueuedTask } = useQueue()
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

  // Resolve the task element by id via the data-task-id attribute on TaskItem.
  const getTaskElement = (taskId: string): HTMLElement | null =>
    document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(taskId)}"]`)

  // For fallback after removal: compute next selection BEFORE removing.
  const computeNextAfterRemoval = (target: Selection): Selection | null => {
    const map = tasksRef.current
    const list = map[target.backend]
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
    const removedEl = getTaskElement(target.taskId)
    const removedRect = removedEl?.getBoundingClientRect()
    const removedCy = removedRect ? removedRect.top + removedRect.height / 2 : null

    const colIdx = visibleBackends.indexOf(target.backend)
    if (colIdx < 0) return null

    const findNearestInCol = (b: BackendId): Selection | null => {
      const colTasks = map[b]
      if (!colTasks || colTasks.length === 0) return null
      if (removedCy === null) {
        return { backend: b, taskId: colTasks[0].id }
      }
      let bestId: string | null = null
      let bestDist = Infinity
      for (const t of colTasks) {
        const el = getTaskElement(t.id)
        if (!el) continue
        const r = el.getBoundingClientRect()
        const cy = r.top + r.height / 2
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

  // If the task being removed is the currently selected one, the fallback
  // picks the next one. Otherwise selection is left alone.
  const transitionSelectionForRemoval = (backend: BackendId, taskId: string): void => {
    const sel = selectionRef.current
    if (!sel || sel.backend !== backend || sel.taskId !== taskId) return
    const next = computeNextAfterRemoval({ backend, taskId })
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
        title: keepingCompleted ? 'Keep Just in Case' : 'Remove Task',
        message: keepingCompleted
          ? 'Keep this completed image just in case and take it out of the active list?'
          : 'Remove this task from the queue?',
        confirmLabel: keepingCompleted ? 'Keep' : 'Remove'
      })
      if (!ok) return
    }

    if (task.status !== 'completed' || !showKeptImages) {
      transitionSelectionForRemoval(backend, taskId)
    } else {
      lastActionRef.current = Date.now()
    }
    await window.electronAPI.removeTask(backend, taskId)
  }, [confirm, settings, showKeptImages, setSelectionInternal])

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
      setSelectionInternal({ backend: bestBackend, taskId: bestTaskId }, { userInitiated: false })
    }
  }, [tasks, settings, setSelectionInternal])

  // ---- Keyboard navigation ----------------------------------------------

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // Skip when typing in form fields.
      const activeElement = document.activeElement as HTMLElement | null
      const tag = activeElement?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (document.querySelector('.modal-backdrop')) return
      // Skip while a modifier is held (don't steal Cmd+1..6, Cmd+Enter, etc.)
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if ((e.key === 'Backspace' || e.key === 'Delete') && e.repeat) return

      const sel = selectionRef.current
      const map = tasksRef.current

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!sel) return
        const list = map[sel.backend]
        const idx = list.findIndex((t) => t.id === sel.taskId)
        if (idx < 0) return
        const nextIdx = e.key === 'ArrowDown' ? idx + 1 : idx - 1
        if (nextIdx < 0 || nextIdx >= list.length) {
          e.preventDefault()
          return
        }
        e.preventDefault()
        const nextId = list[nextIdx].id
        setSelectionInternal({ backend: sel.backend, taskId: nextId }, { userInitiated: true })
        // Scroll into view after React applies the state.
        requestAnimationFrame(() => {
          getTaskElement(nextId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        })
        return
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (!sel) return
        const colIdx = visibleBackends.indexOf(sel.backend)
        if (colIdx < 0) return
        const dir = e.key === 'ArrowRight' ? 1 : -1
        const selEl = getTaskElement(sel.taskId)
        const selRect = selEl?.getBoundingClientRect()
        const cy = selRect ? selRect.top + selRect.height / 2 : null

        for (let i = colIdx + dir; i >= 0 && i < visibleBackends.length; i += dir) {
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
          e.preventDefault()
          setSelectionInternal({ backend: b, taskId: bestId }, { userInitiated: true })
          requestAnimationFrame(() => {
            getTaskElement(bestId!)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          })
          return
        }
        // No neighbor column with tasks — do nothing.
        return
      }

      if (e.key === 'Backspace') {
        if (!sel) return
        const task = map[sel.backend]?.find((t) => t.id === sel.taskId)
        e.preventDefault()
        if (task?.status === 'kept') {
          void restoreSelected()
        } else {
          void removeSelected()
        }
        return
      }

      if (e.key === 'Delete') {
        if (!sel) return
        e.preventDefault()
        void deleteSelected()
        return
      }

      if (e.key === ' ') {
        if (!sel) return
        const task = map[sel.backend]?.find((t) => t.id === sel.taskId)
        if (task?.status !== 'completed' && task?.status !== 'kept') return
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('viewer:toggle'))
        return
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [visibleBackends, removeSelected, restoreSelected, deleteSelected, setSelectionInternal])

  return (
    <SelectionContext.Provider value={{ selection, selectedTask, select, clear, removeTask, restoreTask, deleteTask, removeSelected, restoreSelected, deleteSelected }}>
      {children}
    </SelectionContext.Provider>
  )
}

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext)
  if (!ctx) throw new Error('useSelection must be used within SelectionProvider')
  return ctx
}
