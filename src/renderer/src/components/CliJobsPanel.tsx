import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CliChunk, CliJobKind, CliJobStatus } from '../../../shared/cli-jobs'
import { useCliJobs } from '../context/CliJobsContext'
import './CliJobsPanel.css'

function jobTitle(
  kind: CliJobKind,
  target: string,
  status: CliJobStatus,
  exitCode: number | null
): string {
  if (status === 'queued') {
    return kind === 'import' ? `Queued import: ${target}` : `Queued download: ${target}`
  }
  if (status === 'running' || status === 'stalled') {
    return kind === 'import' ? `Importing ${target}` : `Downloading ${target}`
  }
  if (status === 'exited' && exitCode === 0) {
    return kind === 'import' ? `Imported ${target}` : `Downloaded ${target}`
  }
  if (status === 'killed') return `Stopped: ${target}`
  return `Failed: ${target}`
}

function jobSummary(
  kind: CliJobKind,
  status: CliJobStatus,
  exitCode: number | null,
  chunks: CliChunk[]
): { tone: 'warning' | 'error'; text: string } | null {
  if (status === 'queued') {
    return { tone: 'warning', text: 'Waiting for the previous import to finish.' }
  }
  if (status === 'stalled') {
    return { tone: 'warning', text: 'No progress has appeared for a while. Stop and retry if it stays stuck.' }
  }
  if (status === 'killed') {
    return { tone: 'warning', text: 'Stopped before completion.' }
  }
  if (status !== 'exited' || exitCode === 0) return null

  const lines = chunks.map((chunk) => chunk.text.trim()).filter(Boolean)
  if (lines.some((line) => line.includes('Usage: draw-things-cli'))) {
    return { tone: 'error', text: 'The CLI rejected the command. See the log below.' }
  }
  return {
    tone: 'error',
    text: kind === 'import' ? 'Import failed. See the log below.' : 'Download failed. See the log below.',
  }
}

function jobIcon(kind: CliJobKind, status: CliJobStatus, exitCode: number | null): string {
  if (status === 'queued') return '…'
  if (status === 'running' || status === 'stalled') return kind === 'import' ? '↑' : '↓'
  if (status === 'exited' && exitCode === 0) return '✓'
  if (status === 'killed') return '■'
  return '✗'
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
    })

    return () => {
      cancelled = true
      offChunk()
      offStatus()
      void window.electronAPI.cliUnsubscribeJob(jobId)
    }
  }, [jobId])

  // Auto-scroll log tail to bottom when new chunks arrive.
  useEffect(() => {
    const el = tailRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chunks])

  const isActive = status === 'queued' || status === 'running' || status === 'stalled'
  const title = jobTitle(kind, target, status, exitCode)
  const summary = jobSummary(kind, status, exitCode, chunks)
  const icon = jobIcon(kind, status, exitCode)

  const handleStop = (): void => { void window.electronAPI.cliKillJob(jobId) }

  const titleClass = !isActive
    ? status === 'exited' && exitCode === 0
      ? 'cli-job-row-title cli-job-row-title-success'
      : 'cli-job-row-title cli-job-row-title-error'
    : 'cli-job-row-title'

  return (
    <div className="cli-job-row">
      <div className="cli-job-row-header">
        <span className="cli-job-row-icon" aria-hidden="true">{icon}</span>
        <span className={titleClass} title={title}>{title}</span>
        {isActive ? (
          <button className="cli-job-row-btn cli-job-row-btn-stop" onClick={handleStop}>Stop</button>
        ) : (
          <button className="cli-job-row-btn" onClick={onDismiss} title="Dismiss">×</button>
        )}
      </div>
      {summary && (
        <div className={`cli-job-summary cli-job-summary-${summary.tone}`}>
          {summary.text}
        </div>
      )}
      <div className="cli-job-log-tail" ref={tailRef}>
        {chunks.length === 0 && isActive ? (
          <div className="cli-job-tail-line cli-job-tail-placeholder">
            {status === 'queued'
              ? 'Waiting for earlier import to finish\u2026'
              : status === 'stalled'
                ? 'No new output yet\u2026'
                : kind === 'import'
                  ? 'Conversion in progress\u2026'
                  : 'Starting\u2026'}
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
