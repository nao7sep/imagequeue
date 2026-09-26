import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CliChunk, CliJobKind, CliJobStatus } from '../../../shared/cli-jobs'
import { useCliJobs } from '../context/CliJobsContext'
import { Icon, type IconName } from './Icon'
import { serializeError } from '../../../shared/serialize-error'
import './CliJobsPanel.css'
import { useI18n } from '../i18n/I18nContext'
import type { MessageKey } from '../../../shared/i18n/catalogues'
import { message, type Message } from '../../../shared/i18n/translate'

function jobTitle(
  kind: CliJobKind,
  target: string,
  status: CliJobStatus,
  exitCode: number | null
): Message {
  const title = (key: MessageKey): Message => message(key, { target })
  if (status === 'queued') {
    return title(kind === 'import' ? 'cliJob.queuedImport' : 'cliJob.queuedDownload')
  }
  if (status === 'running' || status === 'stalled') {
    return title(kind === 'import' ? 'cliJob.importing' : 'cliJob.downloading')
  }
  if (status === 'exited' && exitCode === 0) {
    return title(kind === 'import' ? 'cliJob.imported' : 'cliJob.downloaded')
  }
  if (status === 'killed') return title('cliJob.stopped')
  return title('cliJob.failed')
}

function jobSummary(
  kind: CliJobKind,
  status: CliJobStatus,
  exitCode: number | null,
  chunks: CliChunk[]
): { tone: 'warning' | 'error'; text: MessageKey } | null {
  if (status === 'queued') {
    return { tone: 'warning', text: 'cliJob.waiting' }
  }
  if (status === 'stalled') {
    return { tone: 'warning', text: 'cliJob.stalled' }
  }
  if (status === 'killed') {
    return { tone: 'warning', text: 'cliJob.stoppedEarly' }
  }
  if (status !== 'exited' || exitCode === 0) return null

  const lines = chunks.map((chunk) => chunk.text.trim()).filter(Boolean)
  if (lines.some((line) => line.includes('Usage: draw-things-cli'))) {
    return { tone: 'error', text: 'cliJob.rejected' }
  }
  return {
    tone: 'error',
    text: kind === 'import' ? 'cliJob.importFailed' : 'cliJob.downloadFailed',
  }
}

// Status as a drawn icon rather than a typed glyph: ■ and ✗ in particular
// rendered at wildly different weights across fonts, and this row is scanned,
// not read. `null` omits both the mark and its layout slot: terminal titles carry
// their own outcome, and a job that has not started has nothing to illustrate.
export function jobIcon(kind: CliJobKind, status: CliJobStatus, exitCode: number | null): IconName | null {
  if (status === 'queued') return null
  if (status === 'running' || status === 'stalled') return kind === 'import' ? 'upload' : 'download'
  // Terminal titles already say Imported/Downloaded, Stopped, or Failed and use
  // the corresponding result color. A terminal mark only repeats that meaning.
  return null
}

// ─── CliJobRow ────────────────────────────────────────────────────────────────

interface RowProps {
  jobId: string
  kind: CliJobKind
  target: string
  onDismiss: () => void
}

function CliJobRow({ jobId, kind, target, onDismiss }: RowProps): React.JSX.Element {
  const [chunks, setChunks] = useState<CliChunk[]>([])
  const [status, setStatus] = useState<CliJobStatus>('running')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const { t, text } = useI18n()
  const [rowError, setRowError] = useState<MessageKey | null>(null)
  const tailRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false

    const offChunk = window.electronAPI.onCliJobChunk((e) => {
      if (e.jobId !== jobId) return
      if (e.replace) {
        setChunks((prev) => {
          const idx = prev.findIndex((c) => c.seq === e.chunk.seq)
          if (idx === -1) return [...prev, e.chunk]
          const next = [...prev]
          next[idx] = e.chunk
          return next
        })
      } else {
        setChunks((prev) => [...prev, e.chunk])
      }
    })

    const offStatus = window.electronAPI.onCliJobStatus((e) => {
      if (e.jobId !== jobId) return
      setStatus(e.status)
      setExitCode(e.exitCode)
    })

    void window.electronAPI.cliSubscribeJob(jobId).then((snap) => {
      if (cancelled || !snap) return
      setChunks(snap.chunks)
      setStatus(snap.status)
      setExitCode(snap.exitCode)
    }).catch((error) => {
      if (cancelled) return
      setRowError('cliJob.subscribeFailed')
      void window.electronAPI.appLog('error', 'Failed to subscribe to CLI job', { jobId, error: serializeError(error) })
        .catch((logError) => console.error('Failed to record CLI subscription diagnostic', logError))
    })

    return () => {
      cancelled = true
      offChunk()
      offStatus()
      void window.electronAPI.cliUnsubscribeJob(jobId).catch((error) => {
        void window.electronAPI.appLog('error', 'Failed to unsubscribe from CLI job', { jobId, error: serializeError(error) })
          .catch((logError) => console.error('Failed to record CLI unsubscription diagnostic', logError))
      })
    }
  }, [jobId])

  // Auto-scroll log tail to bottom when new chunks arrive.
  useEffect(() => {
    const el = tailRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chunks])

  const isActive = status === 'queued' || status === 'running' || status === 'stalled'
  const title = text(jobTitle(kind, target, status, exitCode))
  const summary = jobSummary(kind, status, exitCode, chunks)
  const icon = jobIcon(kind, status, exitCode)

  const handleStop = (): void => {
    setRowError(null)
    void window.electronAPI.cliKillJob(jobId).catch((error) => {
      setRowError('cliJob.stopFailed')
      void window.electronAPI.appLog('error', 'Failed to stop CLI job', { jobId, error: serializeError(error) })
        .catch((logError) => console.error('Failed to record CLI stop diagnostic', logError))
    })
  }

  const titleClass = !isActive
    ? status === 'exited' && exitCode === 0
      ? 'cli-job-row-title cli-job-row-title-success'
      : 'cli-job-row-title cli-job-row-title-error'
    : 'cli-job-row-title'

  return (
    <div className="cli-job-row">
      <div className="cli-job-row-header">
        {icon && (
          <span className="cli-job-row-icon" aria-hidden="true"><Icon name={icon} /></span>
        )}
        <span className={titleClass} title={title}>{title}</span>
        {isActive ? (
          <button className="cli-job-stop" onClick={handleStop}>{t('queueControls.stop')}</button>
        ) : (
          <button className="cli-job-result-close" onClick={onDismiss} title={t('common.close')} aria-label={t('cliJob.closeResult')}>
            <Icon name="close" />
          </button>
        )}
      </div>
      {summary && (
        <div className={`cli-job-summary cli-job-summary-${summary.tone}`}>
          {t(summary.text)}
        </div>
      )}
      {rowError && <div className="cli-job-summary cli-job-summary-error" role="alert">{t(rowError)}</div>}
      <div
        className="cli-job-log-tail"
        ref={tailRef}
        role="region"
        aria-label={t('cliJob.logLabel', { title })}
        tabIndex={0}
      >
        {chunks.length === 0 && isActive ? (
          <div className="cli-job-tail-line cli-job-tail-placeholder">
            {t(status === 'queued'
              ? 'cliJob.noOutput'
              : status === 'stalled'
                ? 'cliJob.noNewOutput'
                : kind === 'import'
                  ? 'cliJob.converting'
                  : 'cliJob.starting')}
          </div>
        ) : (
          chunks.map((c) => (
            <div key={c.seq} className="cli-job-tail-line">
              {c.text || '\u00a0'}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── CliJobsPanel ─────────────────────────────────────────────────────────────

export function CliJobsPanel(): React.JSX.Element | null {
  const { jobs, removeJob } = useCliJobs()

  if (jobs.size === 0) return null

  return createPortal(
    <div className="cli-jobs-panel">
      {[...jobs.entries()].map(([jobId, meta]) => (
        <CliJobRow
          key={jobId}
          jobId={jobId}
          kind={meta.kind}
          target={meta.target}
          onDismiss={() => removeJob(jobId)}
        />
      ))}
    </div>,
    document.body
  )
}
