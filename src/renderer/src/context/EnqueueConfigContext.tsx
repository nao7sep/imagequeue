import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { BackendId } from '../../../shared/types'

export interface EnqueueConfigSnapshot {
  model: string
  params: Record<string, unknown>
}

interface EnqueueConfigContextValue {
  snapshots: Partial<Record<BackendId, EnqueueConfigSnapshot>>
  setSnapshot: (backend: BackendId, snapshot: EnqueueConfigSnapshot | null) => void
}

const EnqueueConfigContext = createContext<EnqueueConfigContextValue | null>(null)

export function EnqueueConfigProvider({ children }: { children: ReactNode }): React.JSX.Element {
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

  const value = useMemo(() => ({ snapshots, setSnapshot }), [snapshots, setSnapshot])

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
