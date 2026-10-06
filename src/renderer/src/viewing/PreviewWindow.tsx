import { useEffect } from 'react'
import { listKeyFor } from '../../../shared/viewing'
import { Preview } from '../components/Preview'
import { isAnyModalOpen } from '../components/modalStack'
import { recordOperationalDiagnostic } from '../utils/operationalFailure'
import { SurfaceConfirmHost } from './SurfaceConfirmHost'
import { useSelectionSnapshot } from './useSelectionSnapshot'
import './PreviewWindow.css'

// The preview window's page (main/preview-window.ts owns its window): the
// preview alone, following the selection, handing list keys to the main window.
// The prompt tools, Details and actions stay in the main window.
export function PreviewWindowApp(): React.JSX.Element {
  const snapshot = useSelectionSnapshot()

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // A confirmation open here owns the keyboard.
      if (isAnyModalOpen()) return
      const key = listKeyFor(e)
      if (!key) return
      e.preventDefault()
      void window.electronAPI.sendListKey(key).catch((error) => {
        recordOperationalDiagnostic('Failed to hand a key to the main window', error, { key })
      })
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  return (
    <main className="preview-window">
      <Preview task={snapshot?.task ?? null} />
      <SurfaceConfirmHost />
    </main>
  )
}
