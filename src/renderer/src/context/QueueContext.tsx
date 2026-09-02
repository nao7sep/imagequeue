import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'
import type { BackendId, Task, EnqueueRequest } from '../../../shared/types'
import { reportOperationalFailure } from '../utils/operationalFailure'
import { serializeError } from '../../../shared/serialize-error'

interface QueueContextValue {
  tasks: Record<BackendId, Task[]>
  loadState: 'loading' | 'ready' | 'failed'
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
    nanobanana: [],
    grok: [],
    flux: [],
    drawthings: []
  }
}

export function QueueProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [storedTasks, setStoredTasks] = useState<Record<BackendId, Task[]>>(createEmptyTaskMap)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading')
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
    let disposed = false
    let receivedLiveUpdate = false

    // Loading and failure are not empty queues. Keep that distinction explicit
    // until either the initial snapshot or a live update supplies real state.
    void window.electronAPI.getAllStoredTasks()
      .then((initial) => {
        if (disposed || receivedLiveUpdate) return
        setStoredTasks(initial)
        setLoadState('ready')
      })
      .catch((error) => {
        if (!disposed && !receivedLiveUpdate) setLoadState('failed')
        try {
          const logging = window.electronAPI.appLog?.('error', 'Failed to load the initial queue snapshot', { error: serializeError(error) })
          void logging?.catch((logError) => console.error('Failed to record queue hydration diagnostic', logError))
        } catch (logError) {
          console.error('Failed to record queue hydration diagnostic', logError)
        }
      })

    // Subscribe to updates from main process
    const unsubscribe = window.electronAPI.onQueueUpdated((updated) => {
      receivedLiveUpdate = true
      setStoredTasks(updated)
      setLoadState('ready')
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  const toggleShowKeptImages = useCallback(() => {
    setShowKeptImages((current) => !current)
  }, [])

  const enqueue = useCallback(async (request: EnqueueRequest) => {
    try { await window.electronAPI.enqueue(request) } catch (error) {
      reportOperationalFailure('queue-enqueue', 'The task could not be queued. Nothing was added; try again.', 'Failed to enqueue task', error)
    }
  }, [])

  const removeTask = useCallback(async (backend: BackendId, taskId: string) => {
    try { await window.electronAPI.removeTask(backend, taskId) } catch (error) {
      reportOperationalFailure(`task-${taskId}`, 'The task could not be removed. The queue is unchanged; try again.', 'Failed to remove task', error)
    }
  }, [])

  const restoreTask = useCallback(async (backend: BackendId, taskId: string) => {
    try { await window.electronAPI.restoreTask(backend, taskId) } catch (error) {
      reportOperationalFailure(`task-${taskId}`, 'The kept task could not be restored. It remains kept; try again.', 'Failed to restore task', error)
    }
  }, [])

  return (
    <QueueContext.Provider value={{ tasks, loadState, showKeptImages, toggleShowKeptImages, enqueue, removeTask, restoreTask }}>
      {children}
    </QueueContext.Provider>
  )
}

export function useQueue(): QueueContextValue {
  const ctx = useContext(QueueContext)
  if (!ctx) throw new Error('useQueue must be used within QueueProvider')
  return ctx
}
