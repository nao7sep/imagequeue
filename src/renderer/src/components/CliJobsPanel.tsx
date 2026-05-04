import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CliChunk, CliJobKind, CliJobStatus } from '../../../shared/cli-jobs'
import { useCliJobs } from '../context/CliJobsContext'
import './CliJobsPanel.css'

// ─── CliJobRow ────────────────────────────────────────────────────────────────

interface RowProps {
  jobId: string
  kind: CliJobKind
  target: string
  onRetry: (newJobId: string) => void
  onDismiss: () => void
}

function CliJobRow({ jobId, kind, target, onRetry, onDismiss }: RowProps): React.JSX.Element {
  const [chunks, setChunks] = useState<CliChunk[]>([])
  const [status, setStatus] = useState<CliJobStatus>('running')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [stalled, setStalled] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const logRef = useRef<HTMLDivElement | null>(null)
  const stickRef = useRef(true)

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
      setStalled(e.stalled)
    })

    void window.electronAPI.cliSubscribeJob(jobId).then((snap) => {
      if (cancelled || !snap) return
      setChunks(snap.chunks)
      setStatus(snap.status)
      setExitCode(snap.exitCode)
      setStalled(snap.stalled)
    })

    return () => {
      cancelled = true
      offChunk()
      offStatus()
      void window.electronAPI.cliUnsubscribeJob(jobId)
    }
  }, [jobId])

  // Auto-scroll log to bottom unless the user has scrolled up.
  useEffect(() => {
    const el = logRef.current
    if (!el || !stickRef.current) return
    el.scrollTop = el.scrollHeight
  }, [chunks])

  const isRunning = status === 'running' || status === 'stalled'

  const lastStdoutText = [...chunks].reverse().find((c) => c.kind === 'stdout')?.text ?? ''

  const handleStop = (): void => {
    void window.electronAPI.cliKillJob(jobId)
  }

  const handleRetry = async (): Promise<void> => {
    await window.electronAPI.cliKillJob(jobId)
    const newId =
      kind === 'import'
        ? await window.electronAPI.cliStartImport(target)
        : await window.electronAPI.cliStartDownload(target)
    onRetry(newId)
  }

  const iconState = isRunning ? (stalled ? 'stalled' : 'running') : status === 'exited' && exitCode === 0 ? 'success' : 'error'
  const iconChar = iconState === 'running' ? '⟳' : iconState === 'stalled' ? '⚠' : iconState === 'success' ? '✓' : '✗'
  const titleText = kind === 'import' ? `Importing ${target}` : `Downloading ${target}`

  return (
    <div className="cli-job-row">
      <div className="cli-job-row-header">
        <span className="cli-job-row-icon" data-state={iconState}>{iconChar}</span>
        <span className="cli-job-row-title" title={titleText}>{titleText}</span>
        {isRunning ? (
          <button className="cli-job-row-btn cli-job-row-btn-stop" onClick={handleStop}>Stop</button>
        ) : (
          <button className="cli-job-row-btn" onClick={onDismiss}>Dismiss</button>
        )}
      </div>

      {stalled && isRunning && (
        <div className="cli-job-stall-banner">
          No progress for 60 s.{' '}
          <button className="cli-job-inline-btn" onClick={() => void handleRetry()}>
            Stop &amp; retry
          </button>
        </div>
      )}

      {lastStdoutText && (
        <div className="cli-job-progress">{lastStdoutText}</div>
      )}

      {status === 'killed' && <div className="cli-job-progress cli-job-progress-note">Stopped.</div>}
      {status === 'exited' && exitCode !== null && exitCode !== 0 && (
        <div className="cli-job-progress cli-job-progress-err">[exit {exitCode}]</div>
      )}
      {status === 'exited' && exitCode === 0 && (
        <div className="cli-job-progress cli-job-progress-ok">Done.</div>
      )}

      {chunks.length > 0 && (
        <button className="cli-job-expand-btn" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '▲ hide log' : '▼ show log'}
        </button>
      )}

      {expanded && (
        <div
          className="cli-job-log"
          ref={logRef}
          onScroll={() => {
            const el = logRef.current
            if (!el) return
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 16
          }}
        >
          {chunks.map((c) => (
            <div key={c.seq} className={`cli-job-log-line${c.kind === 'stderr' ? ' stderr' : ''}`}>
              {c.text || '\u00a0'}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── CliJobsPanel ─────────────────────────────────────────────────────────────

export function CliJobsPanel(): React.JSX.Element | null {
  const { jobs, removeJob, replaceJob } = useCliJobs()

  if (jobs.size === 0) return null

  return createPortal(
    <div className="cli-jobs-panel">
      {[...jobs.entries()].map(([jobId, meta]) => (
        <CliJobRow
          key={jobId}
          jobId={jobId}
          kind={meta.kind}
          target={meta.target}
          onRetry={(newId) => replaceJob(jobId, newId, meta.kind, meta.target)}
          onDismiss={() => removeJob(jobId)}
        />
      ))}
    </div>,
    document.body
  )
}
