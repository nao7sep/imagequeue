import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { useQueue } from '../context/QueueContext'
import { useConfirm } from '../context/ConfirmContext'
import { useSettings } from '../context/SettingsContext'
import { useListbox } from '../hooks/useListbox'
import { useImeGuard } from '../utils/imeGuard'
import { shouldDeleteToTrash, type SessionSummary, type SessionThumbnail } from '../../../shared'
import { useI18n, type Translator } from '../i18n/I18nContext'
import type { MessageKey } from '../../../shared/i18n/catalogues'
import { message as msg, type Message } from '../../../shared/i18n/translate'
import { sessionDisplayName } from '../utils/sessionName'
import { presentFailure } from '../utils/failurePresentation'
import { sessionImageUrl } from '../../../shared/image-url'
import './SessionsModal.css'

interface Props {
  onClose: () => void
}

function summarizeSession(session: SessionSummary, { text }: Translator): string {
  const parts: Message[] = [
    msg('sessions.complete', { count: session.completedCount }),
    ...(session.keptCount > 0 ? [msg('sessions.kept', { count: session.keptCount })] : []),
    ...(session.retryCount > 0 ? [msg('sessions.retry', { count: session.retryCount })] : []),
    msg('sessions.total', { count: session.taskCounts.total }),
  ]
  // Counts stack through one join entry, so the language chooses the separator.
  return text(parts.reduceRight((rest, first) => msg('common.dotJoin', { first, rest })))
}

// Each thumbnail streams from the app's image scheme and loads lazily, so a long
// session list reads only the previews scrolled into view.
function SessionPreviewStrip({ sessionId, thumbnails }: { sessionId: string; thumbnails: SessionThumbnail[] }): React.JSX.Element | null {
  const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set())

  if (thumbnails.length === 0) return null

  return (
    <div className="session-preview-strip">
      {thumbnails.map(({ baseName }) => missing.has(baseName) ? (
        <div key={baseName} className="session-preview-thumb session-preview-thumb-placeholder" aria-hidden="true" />
      ) : (
        <img
          key={baseName}
          className="session-preview-thumb"
          src={sessionImageUrl(sessionId, baseName)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setMissing((current) => new Set(current).add(baseName))}
        />
      ))}
    </div>
  )
}

export function SessionsModal({ onClose }: Props): React.JSX.Element {
  const { tasks } = useQueue()
  const confirm = useConfirm()
  const i18n = useI18n()
  const { t } = i18n
  const date = (iso: string): string => i18n.dateTime(iso)
  const { settings } = useSettings()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<MessageKey | null>(null)
  const [busySessionId, setBusySessionId] = useState<string | null>(null)
  const [creatingSession, setCreatingSession] = useState(false)
  const [message, setMessage] = useState<MessageKey | null>(null)
  // The active row of the sessions listbox (single source of truth). Manual
  // activation: arrowing only moves this; Enter resumes the active session.
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const isComposing = useImeGuard()

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
    setLoadError(null)
    try {
      const next = await window.electronAPI.listSessions()
      setSessions(next)
    } catch (error) {
      setLoadError(presentFailure('sessions-load', error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshSessions()
  }, [refreshSessions])

  // Keep the active row pointing at a live session: default to the first, and
  // recover to the first when the selected session disappears (after a delete).
  useEffect(() => {
    setSelectedSessionId((prev) =>
      prev && sessions.some((s) => s.sessionId === prev) ? prev : sessions[0]?.sessionId ?? null
    )
  }, [sessions])

  const handleResume = useCallback(async (session: SessionSummary): Promise<void> => {
    if (session.isCurrent || hasGeneratingTasks || creatingSession) return
    if (currentTaskCount > 0) {
      const ok = await confirm({
        title: t('sessions.resumeTitle'),
        message: t('sessions.resumeMessage', { setting: msg('settings.dropEmptySessions') }),
        confirmLabel: t('sessions.resume'),
      })
      if (!ok) return
    }

    setBusySessionId(session.sessionId)
    setMessage(null)
    try {
      await window.electronAPI.resumeSession(session.sessionId)
      onClose()
    } catch (error) {
      setMessage(presentFailure('session-resume', error))
    } finally {
      setBusySessionId(null)
    }
  }, [confirm, creatingSession, currentTaskCount, hasGeneratingTasks, onClose, t])

  const handleCreateSession = useCallback(async (): Promise<void> => {
    if (hasGeneratingTasks || creatingSession) return
    if (currentTaskCount > 0) {
      const ok = await confirm({
        title: t('sessions.newTitle'),
        message: t('sessions.newMessage', { setting: msg('settings.dropEmptySessions') }),
        confirmLabel: t('sessions.start'),
      })
      if (!ok) return
    }

    setCreatingSession(true)
    setMessage(null)
    try {
      await window.electronAPI.createSession()
      onClose()
    } catch (error) {
      setMessage(presentFailure('session-create', error))
    } finally {
      setCreatingSession(false)
    }
  }, [confirm, creatingSession, currentTaskCount, hasGeneratingTasks, onClose, t])

  const handleDelete = useCallback(async (session: SessionSummary): Promise<void> => {
    if (session.isCurrent) return
    const ok = await confirm({
      title: t('sessions.deleteTitle'),
      message: t(deleteToTrash ? 'sessions.deleteTrashMessage' : 'sessions.deletePermanentMessage'),
      confirmLabel: t('task.delete'),
      danger: true,
    })
    if (!ok) return

    setBusySessionId(session.sessionId)
    setMessage(null)
    try {
      await window.electronAPI.deleteSession(session.sessionId)
      await refreshSessions()
    } catch (error) {
      setMessage(presentFailure('session-delete', error))
    } finally {
      setBusySessionId(null)
    }
  }, [confirm, deleteToTrash, refreshSessions, t])

  const handleOpenFolder = useCallback(async (session: SessionSummary): Promise<void> => {
    setBusySessionId(session.sessionId)
    setMessage(null)
    try {
      await window.electronAPI.openSessionFolder(session.sessionId)
    } catch (error) {
      setMessage(presentFailure('session-folder', error))
    } finally {
      setBusySessionId(null)
    }
  }, [])

  // Manual activation: arrowing moves the active card; Enter resumes it. Resume
  // is a destructive queue replacement, so it never fires merely on focus.
  const { listboxProps, getOptionProps } = useListbox({
    ids: sessions.map((s) => s.sessionId),
    selectedId: selectedSessionId,
    onSelect: setSelectedSessionId,
    activation: 'manual',
    onPrimary: (id) => {
      const session = sessions.find((s) => s.sessionId === id)
      if (session) void handleResume(session)
    },
    isComposing,
  })

  return (
    <Modal
      title={t('menu.sessions')}
      className="sessions-modal-box"
      onClose={onClose}
      footer={
        <button className="modal-btn" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="sessions-modal-body">
        <div className="sessions-modal-topbar">
          <p className="sessions-modal-note">
            {t('sessions.note', { setting: msg('settings.dropEmptySessions') })}
          </p>
          <button
            className="modal-btn modal-btn-primary"
            onClick={() => void handleCreateSession()}
            disabled={creatingSession || hasGeneratingTasks || busySessionId !== null}
          >
            {t('sessions.newSession')}
          </button>
        </div>
        {hasGeneratingTasks && (
          <div className="sessions-modal-warning">
            {t('sessions.waitForGeneration')}
          </div>
        )}
        {message && <div className="sessions-modal-message" role="alert">{t(message)}</div>}
        {loadError && (
          <div className="sessions-modal-message" role="alert">{t('sessions.refreshFailed', { reason: t(loadError) })}</div>
        )}
        <div className="sessions-list" aria-label={t('menu.sessions')} aria-busy={loading} {...listboxProps}>
          {sessions.length === 0 && (
            <div className="sessions-modal-empty" role="presentation">
              {loading
                ? t('sessions.loading')
                : loadError
                  ? t('sessions.unavailable')
                  : t('sessions.empty')}
            </div>
          )}
          {sessions.length > 0 && (
            <>
            {sessions.map((session) => {
              const busy = busySessionId === session.sessionId
              const selected = selectedSessionId === session.sessionId
              return (
                <div
                  key={session.sessionId}
                  className={`session-card${selected ? ' selected' : ''}`}
                  {...getOptionProps(session.sessionId)}
                >
                  <div className="session-card-header">
                    <div className="session-card-title-row">
                      <div className="session-card-title">{sessionDisplayName(session.sessionId)}</div>
                      {session.isCurrent && <span className="session-card-badge">{t('sessions.current')}</span>}
                    </div>
                    <div className="session-card-summary">{summarizeSession(session, i18n)}</div>
                  </div>
                  <div className="session-card-meta">
                    <span>{t('sessions.updated', { date: date(session.updatedAt) })}</span>
                    <span>{t('sessions.created', { date: date(session.createdAt) })}</span>
                    {session.lastResumedAt && <span>{t('sessions.resumed', { date: date(session.lastResumedAt) })}</span>}
                  </div>
                  <SessionPreviewStrip sessionId={session.sessionId} thumbnails={session.thumbnails} />
                  {/* Per-row actions are pointer-only (tabIndex -1), never tab
                      stops inside the listbox: the card is the one focusable
                      option, and Enter on it runs the primary (Resume). */}
                  <div className="session-card-actions">
                    <button
                      tabIndex={-1}
                      className="modal-btn"
                      onClick={() => void handleOpenFolder(session)}
                      disabled={busy || creatingSession}
                    >
                      {t('sessions.openFolder')}
                    </button>
                    <button
                      tabIndex={-1}
                      className="modal-btn modal-btn-primary"
                      onClick={() => void handleResume(session)}
                      disabled={busy || session.isCurrent || hasGeneratingTasks || creatingSession}
                    >
                      {t('sessions.resume')}
                    </button>
                    <button
                      tabIndex={-1}
                      className="modal-btn modal-btn-danger"
                      onClick={() => void handleDelete(session)}
                      disabled={busy || session.isCurrent || creatingSession}
                    >
                      {t('task.delete')}
                    </button>
                  </div>
                </div>
              )
            })}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
