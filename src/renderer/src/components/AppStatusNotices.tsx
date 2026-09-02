import { useMemo, useState } from 'react'
import { useQueue } from '../context/QueueContext'
import { useSessionDraft } from '../context/SessionDraftContext'
import { Icon } from './Icon'

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

export function AppStatusNotices(): React.JSX.Element | null {
  const { tasks } = useQueue()
  const { draftPersistenceFailure, dismissDraftPersistenceFailure } = useSessionDraft()
  const [retryingStopped, setRetryingStopped] = useState(false)
  const [retryFailure, setRetryFailure] = useState(false)

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

  if (!draftPersistenceFailure && failed === 0 && interrupted === 0) return null

  const retryStopped = async (): Promise<void> => {
    setRetryingStopped(true)
    setRetryFailure(false)
    try {
      await window.electronAPI.resumeInterruptedTasks()
    } catch {
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
      {draftPersistenceFailure && (
        <section className="app-status-notice app-status-notice-error" role="alert">
          <div className="app-status-notice-copy">
            <strong>Session draft isn’t being saved</strong>
            <span>{draftPersistenceFailure}</span>
          </div>
          <button
            className="app-status-notice-dismiss"
            type="button"
            aria-label="Close session draft save result"
            onClick={dismissDraftPersistenceFailure}
          >
            <Icon name="close" />
          </button>
        </section>
      )}

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
