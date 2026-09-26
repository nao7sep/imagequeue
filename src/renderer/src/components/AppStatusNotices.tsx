import { useEffect, useMemo, useState } from 'react'
import { useQueue } from '../context/QueueContext'
import { useSessionDraft } from '../context/SessionDraftContext'
import { Icon } from './Icon'
import { OPERATIONAL_FAILURE_EVENT, recordOperationalDiagnostic } from '../utils/operationalFailure'
import { useI18n } from '../i18n/I18nContext'
import type { MessageKey } from '../../../shared/i18n/catalogues'
import { message, type Message } from '../../../shared/i18n/translate'

export function AppStatusNotices(): React.JSX.Element | null {
  const { tasks } = useQueue()
  const { draftIssue, dismissDraftIssue } = useSessionDraft()
  const { t, text } = useI18n()
  const [retryingStopped, setRetryingStopped] = useState(false)
  const [retryFailure, setRetryFailure] = useState(false)
  const [operationalFailures, setOperationalFailures] = useState<Record<string, MessageKey>>({})

  useEffect(() => {
    const handle = (event: Event): void => {
      const { key, message } = (event as CustomEvent<{ key: string; message: MessageKey }>).detail
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

  const queueParts: Message[] = []
  if (failed > 0) queueParts.push(message('statusNotices.failed', { count: failed }))
  if (interrupted > 0) queueParts.push(message('statusNotices.stopped', { count: interrupted }))
  const summary = queueParts.length > 0
    ? queueParts.reduceRight((rest, first) => message('statusNotices.and', { first, rest }))
    : null

  return (
    <div className="app-status-notices">
      {draftIssue && (
        <section className="app-status-notice app-status-notice-error" role="alert">
          <div className="app-status-notice-copy">
            <strong>{t(draftIssue.title)}</strong>
            <span>{t(draftIssue.message)}</span>
          </div>
          <button
            className="app-status-notice-dismiss"
            type="button"
            aria-label={t('statusNotices.closeDraftResult')}
            onClick={dismissDraftIssue}
          >
            <Icon name="close" />
          </button>
        </section>
      )}

      {Object.entries(operationalFailures).map(([key, message]) => (
        <section key={key} className="app-status-notice app-status-notice-error" role="alert">
          <div className="app-status-notice-copy"><span>{t(message)}</span></div>
          <button className="app-status-notice-dismiss" type="button" aria-label={t('statusNotices.closeOperationResult')} onClick={() => setOperationalFailures((current) => { const next = { ...current }; delete next[key]; return next })}>
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
            <strong>{t('statusNotices.queueTitle')}</strong>
            <span>
              {summary && text(message(
                retryFailure && interrupted > 0 ? 'statusNotices.queueBodyRetryFailed' : 'statusNotices.queueBody',
                { summary },
              ))}
            </span>
          </div>
          {interrupted > 0 && (
            <button
              className="app-status-notice-action"
              type="button"
              disabled={retryingStopped}
              onClick={() => void retryStopped()}
            >
              {retryingStopped ? t('statusNotices.retrying') : t('statusNotices.retryStopped')}
            </button>
          )}
        </section>
      )}
    </div>
  )
}
