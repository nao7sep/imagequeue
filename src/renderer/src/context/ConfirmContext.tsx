import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ConfirmModal } from '../components/ConfirmModal'

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

  // If the host unmounts (app teardown), settle every outstanding dialog —
  // current and queued — through the cancel path so no awaiting caller hangs.
  useEffect(() => {
    return () => {
      pendingRef.current?.resolve(false)
      pendingRef.current = null
      for (const queued of queueRef.current.splice(0)) queued.resolve(false)
    }
  }, [])

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <ConfirmModal options={pending.options} onSettle={settle} />
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx.confirm
}
