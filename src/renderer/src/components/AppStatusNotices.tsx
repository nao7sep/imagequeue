import { useEffect, useMemo, useState } from 'react'
import { useQueue } from '../context/QueueContext'
import { useSessionDraft } from '../context/SessionDraftContext'
import { Icon } from './Icon'
import { OPERATIONAL_FAILURE_EVENT, recordOperationalDiagnostic } from '../utils/operationalFailure'

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

export function AppStatusNotices(): React.JSX.Element | null {
  const { tasks } = useQueue()
  const { draftIssue, dismissDraftIssue } = useSessionDraft()
  const [retryingStopped, setRetryingStopped] = useState(false)
  const [retryFailure, setRetryFailure] = useState(false)
  const [operationalFailures, setOperationalFailures] = useState<Record<string, string>>({})

  useEffect(() => {
    const handle = (event: Event): void => {
      const { key, message } = (event as CustomEvent<{ key: string; message: string }>).detail
      setOperationalFailures((current) => ({ ...current, [key]: message }))
    }
    window.addEventListener(OPERATIONAL_FAILURE_EVENT, handle)
    return () => window.removeEventListener(OPERATIONAL_FAILURE_EVENT, handle)
  }, [])

  const { failed, interrupted } = useMemo(() => {
    let failedCount = 0
    let interruptedCount = 0
    for (const queue of Object.values(tasks)) {
      for (const task of queue) {
        if (task.status === 'failed') failedCount++
        if (task.status === 'interrupted') interruptedCount++
      }
    }
    return { failed: failedCount, interrupted: interruptedCount }
  }, [tasks])

  if (!draftIssue && Object.keys(operationalFailures).length === 0 && failed === 0 && interrupted === 0) return null

  const retryStopped = async (): Promise<void> => {
    setRetryingStopped(true)
    try {
      await window.electronAPI.resumeInterruptedTasks()
      setRetryFailure(false)
    } catch (error) {
      recordOperationalDiagnostic('Failed to retry stopped tasks', error)
      setRetryFailure(true)
    } finally {
      setRetryingStopped(false)
    }
  }

  const queueParts: string[] = []
  if (failed > 0) queueParts.push(`${plural(failed, 'task')} failed`)
  if (interrupted > 0) queueParts.push(`${plural(interrupted, 'task')} stopped before completion`)

  return (
    <div className="app-status-notices">
      {draftIssue && (
        <section className="app-status-notice app-status-notice-error" role="alert">
          <div className="app-status-notice-copy">
            <strong>{draftIssue.title}</strong>
            <span>{draftIssue.message}</span>
          </div>
          <button
            className="app-status-notice-dismiss"
            type="button"
            aria-label="Close session draft result"
            onClick={dismissDraftIssue}
          >
            <Icon name="close" />
          </button>
        </section>
      )}

      {Object.entries(operationalFailures).map(([key, message]) => (
        <section key={key} className="app-status-notice app-status-notice-error" role="alert">
          <div className="app-status-notice-copy"><span>{message}</span></div>
          <button className="app-status-notice-dismiss" type="button" aria-label="Close operation result" onClick={() => setOperationalFailures((current) => { const next = { ...current }; delete next[key]; return next })}>
            <Icon name="close" />
          </button>
        </section>
      ))}

      {(failed > 0 || interrupted > 0) && (
        <section
          className={`app-status-notice ${failed > 0 ? 'app-status-notice-error' : 'app-status-notice-warning'}`}
          role="alert"
        >
          <div className="app-status-notice-copy">
            <strong>Queue needs attention</strong>
            <span>
              {queueParts.join(' and ')}. Review the highlighted rows for details and retry options.
              {retryFailure && interrupted > 0 ? ' Retrying the stopped tasks failed.' : ''}
            </span>
          </div>
          {interrupted > 0 && (
            <button
              className="app-status-notice-action"
              type="button"
              disabled={retryingStopped}
              onClick={() => void retryStopped()}
            >
              {retryingStopped ? 'Retrying…' : 'Retry stopped'}
            </button>
          )}
        </section>
      )}
    </div>
  )
}
