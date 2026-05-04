import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CliChunk, CliJobKind, CliJobStatus } from '../../../shared/cli-jobs'
import { useCliJobs } from '../context/CliJobsContext'
import './CliJobsPanel.css'

const TAIL_LINES = 3

function jobTitle(
  kind: CliJobKind,
  target: string,
  status: CliJobStatus,
  exitCode: number | null
): string {
  if (status === 'running' || status === 'stalled') {
    return kind === 'import' ? `Importing ${target}` : `Downloading ${target}`
  }
  if (status === 'exited' && exitCode === 0) {
    return kind === 'import' ? `Imported ${target}` : `Downloaded ${target}`
  }
  if (status === 'killed') return `Stopped: ${target}`
  return `Failed: ${target}`
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

  const isRunning = status === 'running' || status === 'stalled'
  const title = jobTitle(kind, target, status, exitCode)

  // Show up to the last TAIL_LINES chunks — no padding, variable height.
  const tail = chunks.slice(-TAIL_LINES)

  const handleStop = (): void => { void window.electronAPI.cliKillJob(jobId) }

  const titleClass = !isRunning
    ? status === 'exited' && exitCode === 0
      ? 'cli-job-row-title cli-job-row-title-success'
      : 'cli-job-row-title cli-job-row-title-error'
    : 'cli-job-row-title'

  return (
    <div className="cli-job-row">
      <div className="cli-job-row-header">
        <span className={titleClass} title={title}>{title}</span>
        {isRunning ? (
          <button className="cli-job-row-btn cli-job-row-btn-stop" onClick={handleStop}>Stop</button>
        ) : (
          <button className="cli-job-row-btn" onClick={onDismiss} title="Dismiss">×</button>
        )}
      </div>
      <div className="cli-job-log-tail">
        {tail.length === 0 && isRunning ? (
          <div className="cli-job-tail-line cli-job-tail-placeholder">
            {kind === 'import' ? 'Conversion in progress\u2026' : 'Starting\u2026'}
          </div>
        ) : (
          tail.map((c) => (
            <div key={c.seq} className={`cli-job-tail-line${c.kind === 'stderr' ? ' stderr' : ''}`}>
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

