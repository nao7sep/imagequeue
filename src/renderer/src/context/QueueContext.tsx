import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { BackendId, Task, EnqueueRequest } from '../../../shared/types'

interface QueueContextValue {
  tasks: Record<BackendId, Task[]>
  promptHistory: string[]
  enqueue: (request: EnqueueRequest) => Promise<void>
  removeTask: (backend: BackendId, taskId: string) => Promise<void>
}

const QueueContext = createContext<QueueContextValue | null>(null)

export function QueueProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [tasks, setTasks] = useState<Record<BackendId, Task[]>>({
    openai: [],
    google: [],
    flux: [],
    local: [],
    nanobanana: []
  })
  const [promptHistory, setPromptHistory] = useState<string[]>([])

  useEffect(() => {
    // Load initial state
    window.electronAPI.getAllTasks().then(setTasks)
    window.electronAPI.getPromptHistory().then(setPromptHistory)

    // Subscribe to updates from main process
    const unsubscribe = window.electronAPI.onQueueUpdated((updated) => {
      setTasks(updated)
    })

    return unsubscribe
  }, [])

  const enqueue = useCallback(async (request: EnqueueRequest) => {
    await window.electronAPI.enqueue(request)
    const history = await window.electronAPI.getPromptHistory()
    setPromptHistory(history)
  }, [])

  const removeTask = useCallback(async (backend: BackendId, taskId: string) => {
    await window.electronAPI.removeTask(backend, taskId)
  }, [])

  return (
    <QueueContext.Provider value={{ tasks, promptHistory, enqueue, removeTask }}>
      {children}
    </QueueContext.Provider>
  )
}

export function useQueue(): QueueContextValue {
  const ctx = useContext(QueueContext)
  if (!ctx) throw new Error('useQueue must be used within QueueProvider')
  return ctx
}
