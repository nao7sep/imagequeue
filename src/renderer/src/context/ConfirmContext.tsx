import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Modal } from '../components/Modal'

export interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>
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
  pendingRef.current = pending

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
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

  const settle = useCallback((value: boolean): void => {
    const p = pendingRef.current
    if (!p) return
    const nextPending = queueRef.current.shift() ?? null
    pendingRef.current = nextPending
    setPending(nextPending)
    p.resolve(value)
  }, [])

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <Modal
          title={pending.options.title ?? 'Confirm'}
          onClose={() => settle(false)}
        >
          <div className="confirm-body">{pending.options.message}</div>
          <div className="confirm-actions">
            <button className="modal-btn" onClick={() => settle(false)}>
              {pending.options.cancelLabel ?? 'Cancel'}
            </button>
            <button
              className={pending.options.danger ? 'modal-btn modal-btn-danger' : 'modal-btn modal-btn-primary'}
              onClick={() => settle(true)}
              autoFocus
            >
              {pending.options.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx.confirm
}
