import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { BackendId } from '../../../shared/types'
import { useQueue } from './QueueContext'
import { getVisibleBackends } from '../utils/visibleBackends'
import {
  buildEnqueueRequest,
  buildEnqueueRequestsForAll,
  type EnqueueConfigSnapshot,
} from '../utils/enqueue'

export type { EnqueueConfigSnapshot } from '../utils/enqueue'

interface EnqueueConfigContextValue {
  snapshots: Partial<Record<BackendId, EnqueueConfigSnapshot>>
  setSnapshot: (backend: BackendId, snapshot: EnqueueConfigSnapshot | null) => void
  // Compose an enqueue request from the given prompt and a column's current
  // snapshot, then dispatch it. The prompt is passed in (owned by the prompt
  // pane), while model/params/readiness come from the column's snapshot — so
  // both the "+ Queue" button and the prompt pane's Send-to-All / Cmd+N share
  // one path with no DOM event bus.
  enqueueToBackend: (backend: BackendId, prompt: string) => void
  enqueueToAll: (prompt: string) => void
}

const EnqueueConfigContext = createContext<EnqueueConfigContextValue | null>(null)

export function EnqueueConfigProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { enqueue } = useQueue()
  const [snapshots, setSnapshots] = useState<Partial<Record<BackendId, EnqueueConfigSnapshot>>>({})

  const setSnapshot = useCallback((backend: BackendId, snapshot: EnqueueConfigSnapshot | null): void => {
    setSnapshots((prev) => {
      if (snapshot === null) {
        const { [backend]: _removed, ...rest } = prev
        return rest
      }
      return { ...prev, [backend]: snapshot }
    })
  }, [])

  const enqueueToBackend = useCallback((backend: BackendId, prompt: string): void => {
    const request = buildEnqueueRequest(backend, prompt, snapshots[backend])
    if (request) void enqueue(request)
  }, [snapshots, enqueue])

  const enqueueToAll = useCallback((prompt: string): void => {
    for (const request of buildEnqueueRequestsForAll(prompt, snapshots, getVisibleBackends())) {
      void enqueue(request)
    }
  }, [snapshots, enqueue])

  const value = useMemo(
    () => ({ snapshots, setSnapshot, enqueueToBackend, enqueueToAll }),
    [snapshots, setSnapshot, enqueueToBackend, enqueueToAll]
  )

  return (
    <EnqueueConfigContext.Provider value={value}>
      {children}
    </EnqueueConfigContext.Provider>
  )
}

export function useEnqueueConfigs(): EnqueueConfigContextValue {
  const ctx = useContext(EnqueueConfigContext)
  if (!ctx) throw new Error('useEnqueueConfigs must be used within EnqueueConfigProvider')
  return ctx
}
