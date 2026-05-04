import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CliChunk, CliJobKind, CliJobStatus } from '../../../shared/cli-jobs'
import { useCliJobs } from '../context/CliJobsContext'
import './CliJobsPanel.css'

const TAIL_LINES = 4
const AUTO_DISMISS_MS = 5000

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
  const onDismissRef = useRef(onDismiss)
  useEffect(() => { onDismissRef.current = onDismiss }, [onDismiss])

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

  // Auto-dismiss once the job is no longer running.
  useEffect(() => {
    if (status === 'running' || status === 'stalled') return
    const t = setTimeout(() => onDismissRef.current(), AUTO_DISMISS_MS)
    return () => clearTimeout(t)
  }, [status])

  const isRunning = status === 'running' || status === 'stalled'
  const title = jobTitle(kind, target, status, exitCode)

  // Show the last TAIL_LINES chunks; pad to fixed height so cards don't jump.
  const tail = chunks.slice(-TAIL_LINES)
  const padCount = Math.max(0, TAIL_LINES - tail.length)

  const handleStop = (): void => { void window.electronAPI.cliKillJob(jobId) }

  return (
    <div className="cli-job-row">
      <div className="cli-job-row-header">
        <span className="cli-job-row-title" title={title}>{title}</span>
        {isRunning ? (
          <button className="cli-job-row-btn cli-job-row-btn-stop" onClick={handleStop}>Stop</button>
        ) : (
          <button className="cli-job-row-btn" onClick={onDismiss} title="Dismiss">×</button>
        )}
      </div>
      <div className="cli-job-log-tail">
        {tail.map((c) => (
          <div key={c.seq} className={`cli-job-tail-line${c.kind === 'stderr' ? ' stderr' : ''}`}>
            {c.text || '\u00a0'}
          </div>
        ))}
        {Array.from({ length: padCount }).map((_, i) => (
          <div key={`pad-${i}`} className="cli-job-tail-line">&nbsp;</div>
        ))}
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

