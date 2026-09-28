import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCliJobs } from '../context/CliJobsContext'
import { useSessionDraft } from '../context/SessionDraftContext'
import { CliJobRow } from './CliJobsPanel'
import { Icon } from './Icon'
import { useI18n } from '../i18n/I18nContext'
import type { MessageKey } from '../../../shared/i18n/catalogues'
import {
  OPERATIONAL_FAILURE_EVENT,
  OPERATIONAL_RESOLVED_EVENT,
  type OperationalFailureDetail,
  type OperationalResolvedDetail,
} from '../utils/operationalFailure'
import './ToastStack.css'

// The app's one in-window toast host. It holds only app-level operation
// failures that have no other home (the draft-save warning, enqueue, the image
// viewer, the output folder, window preferences, queue controls) above the
// download and import cards, which stay nearest the corner. Generation
// failures never come here: each task card and its preview own them.
//
// One toast per operation key. A repeat replaces that toast's text and moves it
// to the newest position, lowest in the stack; a later success of the same
// operation clears it; otherwise it stays until the user closes it. There is
// no count limit: the stack grows upward and scrolls within itself only when
// the window runs out of room.
//
// The completion toast window and sounds (main/notification.ts,
// hooks/useNotifications.ts) are a separate, out-of-app signal and never show
// while this window has focus.

interface FailureEntry { message: MessageKey; seq: number }

interface ToastView {
  id: string
  seq: number
  title?: MessageKey
  body: MessageKey
  closeLabel: MessageKey
  onClose: () => void
}

interface Announcement { seq: number; parts: MessageKey[] }

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

export function ToastStack(): React.JSX.Element {
  const { t } = useI18n()
  const { jobs, removeJob } = useCliJobs()
  const { draftIssue, dismissDraftIssue } = useSessionDraft()

  const seqRef = useRef(0)
  const nextSeq = (): number => ++seqRef.current

  const [failures, setFailures] = useState<Record<string, FailureEntry>>({})
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)

  useEffect(() => {
    const onFailure = (event: Event): void => {
      const { key, message } = (event as CustomEvent<OperationalFailureDetail>).detail
      const seq = nextSeq()
      setFailures((current) => ({ ...current, [key]: { message, seq } }))
      setAnnouncement({ seq, parts: [message] })
    }
    const onResolved = (event: Event): void => {
      const { key } = (event as CustomEvent<OperationalResolvedDetail>).detail
      setFailures((current) => without(current, key))
    }
    window.addEventListener(OPERATIONAL_FAILURE_EVENT, onFailure)
    window.addEventListener(OPERATIONAL_RESOLVED_EVENT, onResolved)
    return () => {
      window.removeEventListener(OPERATIONAL_FAILURE_EVENT, onFailure)
      window.removeEventListener(OPERATIONAL_RESOLVED_EVENT, onResolved)
    }
  }, [])

  // The draft warning is derived state: it takes a position when it first
  // appears or changes, computed during render so the order never flickers.
  const draftSignature = draftIssue ? `${draftIssue.title}|${draftIssue.message}` : null
  const draftSeqRef = useRef<{ signature: string | null; seq: number }>({ signature: null, seq: 0 })
  if (draftSeqRef.current.signature !== draftSignature) {
    draftSeqRef.current = { signature: draftSignature, seq: draftSignature ? nextSeq() : 0 }
  }

  useEffect(() => {
    if (!draftIssue) return
    setAnnouncement({ seq: nextSeq(), parts: [draftIssue.title, draftIssue.message] })
    // Only a new or changed warning is a transition worth announcing.
  }, [draftSignature])

  const toasts: ToastView[] = []
  if (draftIssue) {
    toasts.push({
      id: 'draft',
      seq: draftSeqRef.current.seq,
      title: draftIssue.title,
      body: draftIssue.message,
      closeLabel: 'statusNotices.closeDraftResult',
      onClose: dismissDraftIssue,
    })
  }
  for (const [key, entry] of Object.entries(failures)) {
    toasts.push({
      id: `failure:${key}`,
      seq: entry.seq,
      body: entry.message,
      closeLabel: 'statusNotices.closeOperationResult',
      onClose: () => setFailures((current) => without(current, key)),
    })
  }
  toasts.sort((a, b) => a.seq - b.seq)
  const hasContent = toasts.length > 0 || jobs.size > 0

  // The newest toast sits lowest. When the stack has run out of room and
  // scrolls, a new or updated toast brings the bottom into view.
  const stackRef = useRef<HTMLElement | null>(null)
  const newest = toasts.length > 0 ? toasts[toasts.length - 1].seq : 0
  useLayoutEffect(() => {
    const stack = stackRef.current
    if (stack && newest > 0) stack.scrollTop = stack.scrollHeight
  }, [newest])

  return createPortal(
    <>
      {/* Announcements go through one hidden live region that is always
          mounted; the visible toasts carry no live role, so nothing is read
          twice and focus never moves. */}
      <div className="visually-hidden" role="alert" aria-live="assertive">
        {announcement && <span key={announcement.seq}>{announcement.parts.map((part) => t(part)).join(' ')}</span>}
      </div>
      {hasContent && (
        <section className="toast-stack" aria-label={t('toasts.region')} ref={stackRef}>
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast${toast.title ? ' toast-titled' : ''}`} data-toast-id={toast.id}>
              <div className="toast-copy">
                {toast.title && <strong>{t(toast.title)}</strong>}
                <span>{t(toast.body)}</span>
              </div>
              <button className="toast-close" type="button" aria-label={t(toast.closeLabel)} onClick={toast.onClose}>
                <Icon name="close" />
              </button>
            </div>
          ))}
          {[...jobs.entries()].map(([jobId, meta]) => (
            <CliJobRow key={jobId} jobId={jobId} kind={meta.kind} target={meta.target} onDismiss={() => removeJob(jobId)} />
          ))}
        </section>
      )}
    </>,
    document.body,
  )
}
