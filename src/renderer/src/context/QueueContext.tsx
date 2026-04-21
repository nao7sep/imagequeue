import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { BackendId, Task, EnqueueRequest } from '../../../shared/types'

interface QueueContextValue {
  tasks: Record<BackendId, Task[]>
  enqueue: (request: EnqueueRequest) => Promise<void>
  removeTask: (backend: BackendId, taskId: string) => Promise<void>
}

const QueueContext = createContext<QueueContextValue | null>(null)

export function QueueProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [tasks, setTasks] = useState<Record<BackendId, Task[]>>({
    openai: [],
    imagen: [],
    flux: [],
    drawthings: [],
    nanobanana: []
  })

  useEffect(() => {
    // Load initial state
    window.electronAPI.getAllTasks().then(setTasks)

    // Subscribe to updates from main process
    const unsubscribe = window.electronAPI.onQueueUpdated((updated) => {
      setTasks(updated)
    })

    return unsubscribe
  }, [])

  const enqueue = useCallback(async (request: EnqueueRequest) => {
    await window.electronAPI.enqueue(request)
  }, [])

  const removeTask = useCallback(async (backend: BackendId, taskId: string) => {
    await window.electronAPI.removeTask(backend, taskId)
  }, [])

  return (
    <QueueContext.Provider value={{ tasks, enqueue, removeTask }}>
      {children}
    </QueueContext.Provider>
  )
}

export function useQueue(): QueueContextValue {
  const ctx = useContext(QueueContext)
  if (!ctx) throw new Error('useQueue must be used within QueueProvider')
  return ctx
}
