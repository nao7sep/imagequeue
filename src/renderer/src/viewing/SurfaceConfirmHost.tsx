import { useEffect, useState } from 'react'
import type { SurfaceConfirmRequest } from '../../../shared/viewing'
import { ConfirmModal } from '../components/ConfirmModal'
import { recordOperationalDiagnostic } from '../utils/operationalFailure'

/** Shows, one at a time, the confirmations the main window asks this view for:
 *  a Remove or Delete whose key was pressed here. A request the main process
 *  withdraws, because the view is closing, leaves without an answer. */
export function SurfaceConfirmHost(): React.JSX.Element | null {
  const [requests, setRequests] = useState<SurfaceConfirmRequest[]>([])
  useEffect(() => {
    const unsubscribeAsk = window.electronAPI.onSurfaceConfirm((request) => {
      setRequests((current) => [...current, request])
    })
    const unsubscribeDismiss = window.electronAPI.onSurfaceConfirmDismissed((id) => {
      setRequests((current) => current.filter((request) => request.id !== id))
    })
    return () => {
      unsubscribeAsk()
      unsubscribeDismiss()
    }
  }, [])

  const request = requests[0]
  if (!request) return null
  const settle = (ok: boolean): void => {
    setRequests((current) => current.filter((pending) => pending.id !== request.id))
    void window.electronAPI.answerSurfaceConfirm(request.id, ok).catch((error) => {
      recordOperationalDiagnostic('Failed to answer a confirmation', error, { ok })
    })
  }
  return <ConfirmModal key={request.id} options={request.options} onSettle={settle} />
}
