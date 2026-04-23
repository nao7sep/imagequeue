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
  pendingRef.current = pending

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setPending({ options, resolve })
    })
  }, [])

  const settle = useCallback((value: boolean): void => {
    const p = pendingRef.current
    if (!p) return
    setPending(null)
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
            <button className="confirm-btn" onClick={() => settle(false)}>
              {pending.options.cancelLabel ?? 'Cancel'}
            </button>
            <button
              className={pending.options.danger ? 'confirm-btn confirm-btn-danger' : 'confirm-btn confirm-btn-primary'}
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
