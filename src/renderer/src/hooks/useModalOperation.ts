import { useCallback, useRef, useState } from 'react'
import type { RetainedModalProps } from '../components/RetainedModal'

export const MODAL_OPERATION_WAIT_MS = 30_000

/** Deadline ends the caller wait, never the submitted operation or its draft.
 * The operation starts its clock after any user decision has been answered. */
export function useModalOperation(props: RetainedModalProps) {
  const latest = useRef(props)
  latest.current = props
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(false)

  const hide = useCallback((): void => {
    if (latest.current.visible !== false) latest.current.onClose()
  }, [])
  const close = useCallback((): void => {
    latest.current.retain?.(null)
    hide()
  }, [hide])

  const run = useCallback(async (
    operation: (startWait: () => void) => Promise<'close' | void>,
    onError: (error: unknown) => void,
  ): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    latest.current.retain?.('pending')
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let expire!: () => void
    const deadline = new Promise<void>((resolve) => { expire = () => { setPending(true); resolve() } })
    const startWait = (): void => {
      if (!settled && timer === undefined) timer = setTimeout(expire, MODAL_OPERATION_WAIT_MS)
    }
    const physical = (async (): Promise<void> => {
      try {
        const result = await operation(startWait)
        latest.current.retain?.(null)
        if (result === 'close') hide()
      } catch (error) {
        latest.current.retain?.('failed')
        onError(error)
      } finally {
        settled = true
        clearTimeout(timer)
        busyRef.current = false
        setBusy(false)
        setPending(false)
      }
    })()
    await Promise.race([physical, deadline])
  }, [hide])

  return { busy, busyRef, pending, run, hide, close }
}
