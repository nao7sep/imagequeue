import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import type { CliChunk, CliJobSnapshot, CliJobStatus } from '../../../shared/cli-jobs'
import './CliJobDialog.css'

interface Props {
  jobId: string
  // Allow the host to retry a stalled job by restarting and supplying a new jobId.
  onRetry?: () => Promise<string>
  onClose: () => void
}

export function CliJobDialog({ jobId: initialJobId, onRetry, onClose }: Props): React.JSX.Element | null {
  const [jobId, setJobId] = useState(initialJobId)
  const [snapshot, setSnapshot] = useState<CliJobSnapshot | null>(null)
  const [chunks, setChunks] = useState<CliChunk[]>([])
  const [status, setStatus] = useState<CliJobStatus>('running')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [stalled, setStalled] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)

  // Subscribe / replay / live updates.
  useEffect(() => {
    let cancelled = false

    const offChunk = window.electronAPI.onCliJobChunk((e) => {
      if (e.jobId !== jobId) return
      setChunks((prev) => [...prev, e.chunk])
    })

    const offStatus = window.electronAPI.onCliJobStatus((e) => {
      if (e.jobId !== jobId) return
      setStatus(e.status)
      setExitCode(e.exitCode)
      setStalled(e.stalled)
    })

    void window.electronAPI.cliSubscribeJob(jobId).then((snap) => {
      if (cancelled || !snap) return
      setSnapshot(snap)
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

  // Auto-scroll to bottom when new chunks arrive, unless user has scrolled up.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [chunks])

  const handleScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 16
  }

  const isRunning = status === 'running' || status === 'stalled'

  const handleStop = (): void => {
    void window.electronAPI.cliKillJob(jobId)
  }

  const handleStopAndRetry = async (): Promise<void> => {
    await window.electronAPI.cliKillJob(jobId)
    if (!onRetry) return
    const next = await onRetry()
    setJobId(next)
    setSnapshot(null)
    setChunks([])
    setStatus('running')
    setExitCode(null)
    setStalled(false)
    stickToBottomRef.current = true
  }

  const titlePrefix = snapshot?.kind === 'import' ? 'Importing' : 'Downloading'
  const title = snapshot ? `${titlePrefix} ${snapshot.target}` : 'Starting\u2026'

  // While running: Esc / X hides (keeps job alive). When finished: Esc / X closes.
  const handleDismiss = (): void => {
    if (isRunning) {
      onClose()
    } else {
      onClose()
    }
  }

  return (
    <Modal title={title} onClose={handleDismiss} className="cli-job-dialog">
      <div className="cli-job-body">
        {stalled && isRunning && (
          <div className="cli-job-banner cli-job-banner-warning">
            <span>No progress for 60 s — the server may be unresponsive.</span>
            {onRetry && (
              <button className="cli-job-btn" onClick={() => { void handleStopAndRetry() }}>
                Stop &amp; retry
              </button>
            )}
          </div>
        )}

        <div className="cli-job-output" ref={scrollRef} onScroll={handleScroll}>
          {chunks.map((c) => (
            <div key={c.seq} className={c.kind === 'stderr' ? 'cli-job-line stderr' : 'cli-job-line'}>
              {c.text || '\u00a0'}
            </div>
          ))}
          {chunks.length === 0 && status === 'running' && (
            <div className="cli-job-line note">Starting\u2026</div>
          )}
          {status === 'killed' && <div className="cli-job-line note">Stopped.</div>}
          {status === 'exited' && exitCode !== null && exitCode !== 0 && (
            <div className="cli-job-line stderr">[exit {exitCode}]</div>
          )}
        </div>

        <div className="cli-job-footer">
          {isRunning ? (
            <>
              <button className="cli-job-btn" onClick={onClose}>Hide</button>
              <button className="cli-job-btn cli-job-btn-danger" onClick={handleStop}>Stop</button>
            </>
          ) : (
            <button className="cli-job-btn" onClick={onClose}>Close</button>
          )}
        </div>
      </div>
    </Modal>
  )
}
