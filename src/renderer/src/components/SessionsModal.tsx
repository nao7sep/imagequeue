import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { useQueue } from '../context/QueueContext'
import { useConfirm } from '../context/ConfirmContext'
import type { SessionSummary } from '../../../shared/types'
import { formatUiDateTime } from '../utils/formatDateTime'
import './SessionsModal.css'

interface Props {
  onClose: () => void
}

function summarizeSession(session: SessionSummary): string {
  const retryCount = session.taskCounts.total - session.taskCounts.completed
  const parts = [
    `${session.taskCounts.completed} complete`,
    `${retryCount} retry`,
    `${session.taskCounts.total} total`,
  ]
  return parts.join(' · ')
}

export function SessionsModal({ onClose }: Props): React.JSX.Element {
  const { tasks } = useQueue()
  const confirm = useConfirm()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busySessionId, setBusySessionId] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const currentTaskCount = useMemo(
    () => Object.values(tasks).reduce((total, list) => total + list.length, 0),
    [tasks]
  )
  const hasGeneratingTasks = useMemo(
    () => Object.values(tasks).some((list) => list.some((task) => task.status === 'generating')),
    [tasks]
  )

  const refreshSessions = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const next = await window.electronAPI.listSessions()
      setSessions(next)
      setMessage('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshSessions()
  }, [refreshSessions])

  const handleResume = useCallback(async (session: SessionSummary): Promise<void> => {
    if (session.isCurrent || hasGeneratingTasks) return
    if (currentTaskCount > 0) {
      const ok = await confirm({
        title: 'Resume Session',
        message: 'Replace the current queue with this session? Your current session will stay saved and can be resumed later.',
        confirmLabel: 'Resume',
      })
      if (!ok) return
    }

    setBusySessionId(session.sessionId)
    setMessage('')
    try {
      await window.electronAPI.resumeSession(session.sessionId)
      onClose()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusySessionId(null)
    }
  }, [confirm, currentTaskCount, hasGeneratingTasks, onClose])

  const handleDelete = useCallback(async (session: SessionSummary): Promise<void> => {
    if (session.isCurrent) return
    const ok = await confirm({
      title: 'Delete Session',
      message: 'Move this session folder to the Trash? Generated images and metadata in that session will be removed from ImageQueue history.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return

    setBusySessionId(session.sessionId)
    setMessage('')
    try {
      await window.electronAPI.deleteSession(session.sessionId)
      await refreshSessions()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusySessionId(null)
    }
  }, [confirm, refreshSessions])

  const handleOpenFolder = useCallback(async (session: SessionSummary): Promise<void> => {
    setBusySessionId(session.sessionId)
    setMessage('')
    try {
      await window.electronAPI.openSessionFolder(session.sessionId)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusySessionId(null)
    }
  }, [])

  return (
    <Modal title="Sessions" className="sessions-modal-box" onClose={onClose}>
      <div className="sessions-modal-body">
        <p className="sessions-modal-note">
          Resume restores unfinished work as retryable interrupted tasks.
        </p>
        {hasGeneratingTasks && (
          <div className="sessions-modal-warning">
            Wait for active generation to finish before resuming another session.
          </div>
        )}
        {message && <div className="sessions-modal-message">{message}</div>}
        {loading ? (
          <div className="sessions-modal-empty">Loading sessions…</div>
        ) : sessions.length === 0 ? (
          <div className="sessions-modal-empty">No saved sessions yet.</div>
        ) : (
          <div className="sessions-list">
            {sessions.map((session) => {
              const busy = busySessionId === session.sessionId
              return (
                <div key={session.sessionId} className="session-card">
                  <div className="session-card-header">
                    <div className="session-card-title-row">
                      <div className="session-card-title">{session.sessionId}</div>
                      {session.isCurrent && <span className="session-card-badge">Current</span>}
                    </div>
                    <div className="session-card-summary">{summarizeSession(session)}</div>
                  </div>
                  <div className="session-card-meta">
                    <span>Updated {formatUiDateTime(session.updatedAt)}</span>
                    <span>Created {formatUiDateTime(session.createdAt)}</span>
                    {session.lastResumedAt && <span>Resumed {formatUiDateTime(session.lastResumedAt)}</span>}
                  </div>
                  <div className="session-card-actions">
                    <button
                      className="session-card-btn"
                      onClick={() => void handleOpenFolder(session)}
                      disabled={busy}
                    >
                      Open Folder
                    </button>
                    <button
                      className="session-card-btn session-card-btn-primary"
                      onClick={() => void handleResume(session)}
                      disabled={busy || session.isCurrent || hasGeneratingTasks}
                    >
                      Resume
                    </button>
                    <button
                      className="session-card-btn session-card-btn-danger"
                      onClick={() => void handleDelete(session)}
                      disabled={busy || session.isCurrent}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}
