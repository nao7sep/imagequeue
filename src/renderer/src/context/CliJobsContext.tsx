import { createContext, useContext, useState, type ReactNode } from 'react'
import type { CliJobKind } from '../../../shared/cli-jobs'

interface JobMeta {
  kind: CliJobKind
  target: string
}

interface CliJobsContextValue {
  jobs: Map<string, JobMeta>
  addJob: (jobId: string, kind: CliJobKind, target: string) => void
  removeJob: (jobId: string) => void
  replaceJob: (oldId: string, newId: string, kind: CliJobKind, target: string) => void
}

const CliJobsContext = createContext<CliJobsContextValue | null>(null)

export function CliJobsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [jobs, setJobs] = useState<Map<string, JobMeta>>(new Map())

  const addJob = (jobId: string, kind: CliJobKind, target: string): void => {
    setJobs((prev) => new Map(prev).set(jobId, { kind, target }))
  }

  const removeJob = (jobId: string): void => {
    setJobs((prev) => {
      const next = new Map(prev)
      next.delete(jobId)
      return next
    })
  }

  const replaceJob = (oldId: string, newId: string, kind: CliJobKind, target: string): void => {
    setJobs((prev) => {
      const next = new Map(prev)
      next.delete(oldId)
      next.set(newId, { kind, target })
      return next
    })
  }

  return (
    <CliJobsContext.Provider value={{ jobs, addJob, removeJob, replaceJob }}>
      {children}
    </CliJobsContext.Provider>
  )
}

export function useCliJobs(): CliJobsContextValue {
  const ctx = useContext(CliJobsContext)
  if (!ctx) throw new Error('useCliJobs must be used inside CliJobsProvider')
  return ctx
}
