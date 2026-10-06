import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ConfirmModal } from '../components/ConfirmModal'
import { AppNoticeModal } from '../components/AppNoticeModal'
import type { AppNotice } from '../../../shared/app-notice'
import type { ConfirmOptions } from '../../../shared/confirm'
import type { ViewingSurface } from '../../../shared/viewing'
import { recordOperationalDiagnostic } from '../utils/operationalFailure'

export type { ConfirmOptions }

/** Asks for a confirmation in this window, or in the view the gesture came
 *  from (the preview window or the fullscreen view), where the user is looking. */
export type Confirm = (options: ConfirmOptions, surface?: ViewingSurface) => Promise<boolean>

interface ConfirmContextValue {
  confirm: Confirm
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

interface PendingConfirm {
  options: ConfirmOptions
  resolve: (value: boolean) => void
}

export function ConfirmProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const pendingRef = useRef<PendingConfirm | null>(null)
  const queueRef = useRef<PendingConfirm[]>([])
  const [notice, setNotice] = useState<AppNotice | null>(null)
  const noticeRef = useRef<AppNotice | null>(null)
  const noticeQueueRef = useRef<AppNotice[]>([])
  pendingRef.current = pending
  noticeRef.current = notice

  useEffect(() => {
    const show = (next: AppNotice): void => {
      if (noticeRef.current) {
        noticeQueueRef.current.push(next)
      } else {
        noticeRef.current = next
        setNotice(next)
      }
    }
    let subscribed = true
    const unsubscribe = window.electronAPI.onAppNotice(show)
    void window.electronAPI.takePendingNotices().then((pending) => {
      if (subscribed) pending.forEach(show)
    })
    return () => {
      subscribed = false
      unsubscribe()
    }
  }, [])

  const confirmHere = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const nextPending = { options, resolve }
      if (!pendingRef.current) {
        pendingRef.current = nextPending
        setPending(nextPending)
      } else {
        queueRef.current.push(nextPending)
      }
    })
  }, [])

  const confirm = useCallback<Confirm>((options, surface) => {
    if (!surface) return confirmHere(options)
    // A view that has closed in the meantime answers null: ask here instead.
    return window.electronAPI.confirmInSurface(surface, options).then(
      (answer) => answer ?? confirmHere(options),
      (error) => {
        recordOperationalDiagnostic('Failed to ask for a confirmation in another view', error, { surface })
        return false
      },
    )
  }, [confirmHere])

  const settle = useCallback((value: boolean): void => {
    const p = pendingRef.current
    if (!p) return
    const nextPending = queueRef.current.shift() ?? null
    pendingRef.current = nextPending
    setPending(nextPending)
    p.resolve(value)
  }, [])

  const closeNotice = useCallback((): void => {
    const next = noticeQueueRef.current.shift() ?? null
    noticeRef.current = next
    setNotice(next)
  }, [])

  // If the host unmounts (app teardown), settle every outstanding dialog —
  // current and queued — through the cancel path so no awaiting caller hangs.
  useEffect(() => {
    return () => {
      pendingRef.current?.resolve(false)
      pendingRef.current = null
      for (const queued of queueRef.current.splice(0)) queued.resolve(false)
      noticeRef.current = null
      noticeQueueRef.current.length = 0
    }
  }, [])

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <ConfirmModal options={pending.options} onSettle={settle} />
      )}
      {notice && <AppNoticeModal notice={notice} onClose={closeNotice} />}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): Confirm {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx.confirm
}
