import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'
import type { BackendId, Task, EnqueueRequest } from '../../../shared/types'

interface QueueContextValue {
  tasks: Record<BackendId, Task[]>
  showKeptImages: boolean
  toggleShowKeptImages: () => void
  enqueue: (request: EnqueueRequest) => Promise<void>
  removeTask: (backend: BackendId, taskId: string) => Promise<void>
  restoreTask: (backend: BackendId, taskId: string) => Promise<void>
}

const QueueContext = createContext<QueueContextValue | null>(null)

function createEmptyTaskMap(): Record<BackendId, Task[]> {
  return {
    openai: [],
    imagen: [],
    nanobanana: [],
    grok: [],
    flux: [],
    drawthings: []
  }
}

export function QueueProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [storedTasks, setStoredTasks] = useState<Record<BackendId, Task[]>>(createEmptyTaskMap)
  // Intentionally not persisted: kept images are mainly a per-session review
  // aid for clearing acceptable results out of the active queue, and are
  // usually obsolete by the next session. Start clean each launch and let the
  // user opt back in via ⌘⇧K.
  const [showKeptImages, setShowKeptImages] = useState(false)

  const tasks = useMemo(() => {
    if (showKeptImages) return storedTasks

    const visible = createEmptyTaskMap()
    for (const backend of Object.keys(visible) as BackendId[]) {
      visible[backend] = storedTasks[backend].filter((task) => task.status !== 'kept')
    }
    return visible
  }, [showKeptImages, storedTasks])

  useEffect(() => {
    // Load initial state
    window.electronAPI.getAllStoredTasks().then(setStoredTasks)

    // Subscribe to updates from main process
    const unsubscribe = window.electronAPI.onQueueUpdated((updated) => {
      setStoredTasks(updated)
    })

    return unsubscribe
  }, [])

  const toggleShowKeptImages = useCallback(() => {
    setShowKeptImages((current) => !current)
  }, [])

  const enqueue = useCallback(async (request: EnqueueRequest) => {
    await window.electronAPI.enqueue(request)
  }, [])

  const removeTask = useCallback(async (backend: BackendId, taskId: string) => {
    await window.electronAPI.removeTask(backend, taskId)
  }, [])

  const restoreTask = useCallback(async (backend: BackendId, taskId: string) => {
    await window.electronAPI.restoreTask(backend, taskId)
  }, [])

  return (
    <QueueContext.Provider value={{ tasks, showKeptImages, toggleShowKeptImages, enqueue, removeTask, restoreTask }}>
      {children}
    </QueueContext.Provider>
  )
}

export function useQueue(): QueueContextValue {
  const ctx = useContext(QueueContext)
  if (!ctx) throw new Error('useQueue must be used within QueueProvider')
  return ctx
}
