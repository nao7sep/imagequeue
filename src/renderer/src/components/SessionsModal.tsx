import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { useQueue } from '../context/QueueContext'
import { useConfirm } from '../context/ConfirmContext'
import { useSettings } from '../context/SettingsContext'
import { shouldDeleteToTrash, type SessionSummary, type SessionThumbnail } from '../../../shared'
import { formatUiDateTime } from '../utils/formatDateTime'
import './SessionsModal.css'

interface Props {
  onClose: () => void
}

function summarizeSession(session: SessionSummary): string {
  const parts = [
    `${session.completedCount} complete`,
    ...(session.keptCount > 0 ? [`${session.keptCount} just-in-case`] : []),
    `${session.retryCount} retry`,
    `${session.taskCounts.total} total`,
  ]
  return parts.join(' · ')
}

function SessionPreviewStrip({ sessionId, thumbnails }: { sessionId: string; thumbnails: SessionThumbnail[] }): React.JSX.Element | null {
  const [images, setImages] = useState<Record<string, string>>({})

  useEffect(() => {
    let disposed = false

    if (thumbnails.length === 0) {
      setImages({})
      return
    }

    void Promise.all(
      thumbnails.map(async ({ baseName }) => {
        const result = await window.electronAPI.getSessionImage(sessionId, baseName)
        if (!result) return null
        const mime = result.ext === 'jpg' ? 'image/jpeg' : `image/${result.ext}`
        return [baseName, `data:${mime};base64,${result.data}`] as const
      })
    ).then((entries) => {
      if (disposed) return
      const next: Record<string, string> = {}
      for (const entry of entries) {
        if (!entry) continue
        next[entry[0]] = entry[1]
      }
      setImages(next)
    })

    return () => {
      disposed = true
    }
  }, [sessionId, thumbnails])

  if (thumbnails.length === 0) return null

  return (
    <div className="session-preview-strip">
      {thumbnails.map(({ baseName }) => {
        const src = images[baseName]
        return src ? (
          <img key={baseName} className="session-preview-thumb" src={src} alt="" />
        ) : (
          <div key={baseName} className="session-preview-thumb session-preview-thumb-placeholder" aria-hidden="true" />
        )
      })}
    </div>
  )
}

export function SessionsModal({ onClose }: Props): React.JSX.Element {
  const { tasks } = useQueue()
  const confirm = useConfirm()
  const { settings } = useSettings()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busySessionId, setBusySessionId] = useState<string | null>(null)
  const [creatingSession, setCreatingSession] = useState(false)
  const [message, setMessage] = useState('')

  const currentTaskCount = useMemo(
    () => Object.values(tasks).reduce((total, list) => total + list.length, 0),
    [tasks]
  )
  const hasGeneratingTasks = useMemo(
    () => Object.values(tasks).some((list) => list.some((task) => task.status === 'generating')),
    [tasks]
  )
  const deleteToTrash = useMemo(
    () => shouldDeleteToTrash((settings?.general as { delete_to_trash?: unknown } | undefined)?.delete_to_trash),
    [settings]
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
    if (session.isCurrent || hasGeneratingTasks || creatingSession) return
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
  }, [confirm, creatingSession, currentTaskCount, hasGeneratingTasks, onClose])

  const handleCreateSession = useCallback(async (): Promise<void> => {
    if (hasGeneratingTasks || creatingSession) return
    if (currentTaskCount > 0) {
      const ok = await confirm({
        title: 'Start New Session',
        message: 'Start a new session? Your current session will stay saved and can be resumed later.',
        confirmLabel: 'Start',
      })
      if (!ok) return
    }

    setCreatingSession(true)
    setMessage('')
    try {
      await window.electronAPI.createSession()
      onClose()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setCreatingSession(false)
    }
  }, [confirm, creatingSession, currentTaskCount, hasGeneratingTasks, onClose])

  const handleDelete = useCallback(async (session: SessionSummary): Promise<void> => {
    if (session.isCurrent) return
    const ok = await confirm({
      title: 'Delete Session',
      message: deleteToTrash
        ? 'Move this session folder to the Trash? Generated images and metadata in that session will be removed from ImageQueue history.'
        : 'Permanently delete this session folder? Generated images and metadata in that session will be removed from ImageQueue history.',
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
  }, [confirm, deleteToTrash, refreshSessions])

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
        <div className="sessions-modal-topbar">
          <p className="sessions-modal-note">
            New Session starts fresh. Resume restores interrupted work for retry.
          </p>
          <button
            className="session-card-btn session-card-btn-primary sessions-new-btn"
            onClick={() => void handleCreateSession()}
            disabled={creatingSession || hasGeneratingTasks || busySessionId !== null}
          >
            New Session
          </button>
        </div>
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
                  <SessionPreviewStrip sessionId={session.sessionId} thumbnails={session.thumbnails} />
                  <div className="session-card-actions">
                    <button
                      className="session-card-btn"
                      onClick={() => void handleOpenFolder(session)}
                      disabled={busy || creatingSession}
                    >
                      Open Folder
                    </button>
                    <button
                      className="session-card-btn session-card-btn-primary"
                      onClick={() => void handleResume(session)}
                      disabled={busy || session.isCurrent || hasGeneratingTasks || creatingSession}
                    >
                      Resume
                    </button>
                    <button
                      className="session-card-btn session-card-btn-danger"
                      onClick={() => void handleDelete(session)}
                      disabled={busy || session.isCurrent || creatingSession}
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
