import { useEffect, useRef, useState } from 'react'
import { CLI_JOB_BUFFER_MAX_LINES, type CliChunk, type CliJobKind, type CliJobStatus } from '../../../shared/cli-jobs'
import { Icon, type IconName } from './Icon'
import { serializeError } from '../../../shared/serialize-error'
import './CliJobsPanel.css'
import { useI18n } from '../i18n/I18nContext'
import type { MessageKey } from '../../../shared/i18n/catalogues'
import { message, type Message } from '../../../shared/i18n/translate'
import { shortenName, shortenPath } from '../../../shared/textCleanup'

function jobTitle(
  kind: CliJobKind,
  target: string,
  status: CliJobStatus,
  exitCode: number | null
): Message {
  // An import names the file the user chose, a download the model file.
  const shown = kind === 'import' ? shortenPath(target) : shortenName(target)
  const title = (key: MessageKey): Message => message(key, { target: shown })
  if (status === 'queued') {
    return title(kind === 'import' ? 'cliJob.queuedImport' : 'cliJob.queuedDownload')
  }
  if (status === 'running' || status === 'stalled') {
    return title(kind === 'import' ? 'cliJob.importing' : 'cliJob.downloading')
  }
  if (status === 'exited' && exitCode === 0) {
    return title(kind === 'import' ? 'cliJob.imported' : 'cliJob.downloaded')
  }
  if (status === 'stopping') return title('cliJob.stopping')
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
  if (status === 'stopping') {
    return { tone: 'warning', text: 'cliJob.waitingToStop' }
  }
  if (status === 'timed-out') {
    return { tone: 'error', text: kind === 'download' ? 'cliJob.downloadTimedOut' : 'cliJob.importTimedOut' }
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

export function CliJobRow({ jobId, kind, target, onDismiss }: RowProps): React.JSX.Element {
  const [chunks, setChunks] = useState<CliChunk[]>([])
  const [status, setStatus] = useState<CliJobStatus>('running')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const { t, text } = useI18n()
  const [rowError, setRowError] = useState<MessageKey | null>(null)
  const tailRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    let liveStatusReceived = false
    let recent: CliChunk[] = []
    let discardedThrough = -1
    // The subscription snapshot may arrive after live events. Keep the newest
    // version of each line and never reintroduce a line already evicted here.
    const mergeChunks = (incoming: CliChunk[], snapshot = false): void => {
      const bySeq = new Map(recent.map((chunk) => [chunk.seq, chunk]))
      for (const chunk of incoming) {
        if (chunk.seq <= discardedThrough || (snapshot && bySeq.has(chunk.seq))) continue
        bySeq.set(chunk.seq, chunk)
      }
      const ordered = [...bySeq.values()].sort((a, b) => a.seq - b.seq)
      const removed = ordered.length - CLI_JOB_BUFFER_MAX_LINES
      if (removed > 0) discardedThrough = ordered[removed - 1].seq
      recent = removed > 0 ? ordered.slice(removed) : ordered
      setChunks(recent)
    }

    const offChunk = window.electronAPI.onCliJobChunk((e) => {
      if (e.jobId !== jobId) return
      mergeChunks([e.chunk])
    })

    const offStatus = window.electronAPI.onCliJobStatus((e) => {
      if (e.jobId !== jobId) return
      liveStatusReceived = true
      setStatus(e.status)
      setExitCode(e.exitCode)
    })

    void window.electronAPI.cliSubscribeJob(jobId).then((snap) => {
      if (cancelled || !snap) return
      mergeChunks(snap.chunks, true)
      if (!liveStatusReceived) {
        setStatus(snap.status)
        setExitCode(snap.exitCode)
      }
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

  const isActive = status === 'queued' || status === 'running' || status === 'stalled' || status === 'stopping'
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
        <span className={titleClass}>{title}</span>
        {isActive ? (
          <button className="cli-job-stop" onClick={handleStop} disabled={status === 'stopping'}>{t('queueControls.stop')}</button>
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
      {/* Main keeps the last CLI_JOB_BUFFER_MAX_LINES chunks, numbered from 0, so a
          first chunk past 0 means this view starts partway through the output.
          Say so rather than imply it is the whole log; Records keeps every line
          (localization-conventions, Ellipsis: a partly loaded body). */}
      {(chunks[0]?.seq ?? 0) > 0 && <div className="cli-job-tail-note">{t('cliJob.earlierOutputHidden')}</div>}
      <div
        className="cli-job-log-tail"
        ref={tailRef}
        role="region"
        aria-label={t('cliJob.logLabel', { title })}
        tabIndex={0}
      >
        {chunks.length === 0 && isActive ? (
          <div className="cli-job-tail-line cli-job-tail-placeholder">
            {t(status === 'queued' || status === 'stopping'
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
