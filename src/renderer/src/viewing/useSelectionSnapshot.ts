import { useEffect, useState } from 'react'
import { newerSnapshot, type SelectionSnapshot } from '../../../shared/viewing'
import { recordOperationalDiagnostic } from '../utils/operationalFailure'

/** The selection a view follows: the latest snapshot on load, then each one the
 *  main process forwards, never going back to an older one. */
export function useSelectionSnapshot(): SelectionSnapshot | null {
  const [snapshot, setSnapshot] = useState<SelectionSnapshot | null>(null)
  useEffect(() => {
    let current = true
    const accept = (next: SelectionSnapshot): void => {
      if (current) setSnapshot((shown) => newerSnapshot(shown, next))
    }
    const unsubscribe = window.electronAPI.onSelectionSnapshot(accept)
    void window.electronAPI.getLatestSelection().then(accept, (error) => {
      recordOperationalDiagnostic('Failed to read the selection for a view', error)
    })
    return () => {
      current = false
      unsubscribe()
    }
  }, [])
  return snapshot
}
