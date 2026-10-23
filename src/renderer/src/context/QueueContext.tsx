import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'
import type { BackendId, Task, EnqueueRequest, EnqueueBatchUnit } from '../../../shared/types'
import { isQueueTaskVisible } from '../../../shared/queue-visibility'
import { reportOperationalFailure, clearOperationalFailure } from '../utils/operationalFailure'
import { serializeError } from '../../../shared/serialize-error'

interface QueueContextValue {
  tasks: Record<BackendId, Task[]>
  loadState: 'loading' | 'ready' | 'failed'
  showKeptImages: boolean
  toggleShowKeptImages: () => void
  enqueue: (request: EnqueueRequest) => Promise<void>
  enqueueBatch: (units: EnqueueBatchUnit[]) => Promise<void>
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
  // Main owns this launch-only presentation choice across renderer lifetimes.
  const [showKeptImages, setShowKeptImages] = useState(false)

  const tasks = useMemo(() => {
    if (showKeptImages) return storedTasks

    const visible = createEmptyTaskMap()
    for (const backend of Object.keys(visible) as BackendId[]) {
      visible[backend] = storedTasks[backend].filter((task) => isQueueTaskVisible(task, showKeptImages))
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

  useEffect(() => {
    let disposed = false
    let receivedUpdate = false
    const unsubscribe = window.electronAPI.onShowKeptImagesChanged((visible) => {
      receivedUpdate = true
      setShowKeptImages(visible)
      clearOperationalFailure('queue-kept-visibility-load')
    })
    void window.electronAPI.getShowKeptImages().then((visible) => {
      if (disposed || receivedUpdate) return
      setShowKeptImages(visible)
      clearOperationalFailure('queue-kept-visibility-load')
    }).catch((error) => {
      if (!disposed && !receivedUpdate) reportOperationalFailure('queue-kept-visibility-load', 'operation.uiStateLoadFailed', 'Failed to load kept-image visibility', error)
    })
    return () => { disposed = true; unsubscribe() }
  }, [])

  const toggleShowKeptImages = useCallback(() => {
    void window.electronAPI.toggleShowKeptImages()
      .then(() => clearOperationalFailure('queue-kept-visibility-save'))
      .catch((error) => reportOperationalFailure('queue-kept-visibility-save', 'operation.uiStateSaveFailed', 'Failed to change kept-image visibility', error))
  }, [])

  const enqueue = useCallback(async (request: EnqueueRequest) => {
    try { await window.electronAPI.enqueue(request) } catch (error) {
      reportOperationalFailure('queue-enqueue', 'operation.enqueueFailed', 'Failed to enqueue task', error)
    }
  }, [])

  const enqueueBatch = useCallback(async (units: EnqueueBatchUnit[]) => {
    try { await window.electronAPI.enqueueBatch(units) } catch (error) {
      reportOperationalFailure('queue-enqueue', 'operation.enqueueFailed', 'Failed to enqueue tasks', error)
    }
  }, [])

  return (
    <QueueContext.Provider value={{ tasks, loadState, showKeptImages, toggleShowKeptImages, enqueue, enqueueBatch }}>
      {children}
    </QueueContext.Provider>
  )
}

export function useQueue(): QueueContextValue {
  const ctx = useContext(QueueContext)
  if (!ctx) throw new Error('useQueue must be used within QueueProvider')
  return ctx
}
