import { useEffect, useState } from 'react'
import { listKeyFor, type SelectedImage } from '../../../shared/viewing'
import { windowCommandFor } from '../utils/shortcuts'
import { Preview } from '../components/Preview'
import { isAnyModalOpen } from '../components/modalStack'
import { recordOperationalDiagnostic } from '../utils/operationalFailure'
import { SurfaceConfirmHost } from './SurfaceConfirmHost'
import { useSelectionSnapshot } from './useSelectionSnapshot'
import './PreviewWindow.css'

// The preview window's page (main/preview-window.ts owns its window): the
// preview alone, following the selection. It answers the main window's keys
// the same way: list keys and shortcuts go to the main window, and Space opens
// the fullscreen view from here. The prompt tools, Details and actions stay in
// the main window.
export function PreviewWindowApp(): React.JSX.Element {
  const snapshot = useSelectionSnapshot()
  const [readyTask, setReadyTask] = useState<SelectedImage | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // A confirmation open here owns the keyboard.
      if (isAnyModalOpen()) return
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
      if (plain && e.key === ' ') {
        e.preventDefault()
        // As the lists do, only on an image that is on screen.
        if (e.repeat || !readyTask || readyTask !== snapshot?.task) return
        void window.electronAPI.openFullscreenView().catch((error) => {
          recordOperationalDiagnostic('Failed to open the fullscreen view from the preview window', error)
        })
        return
      }
      const command = windowCommandFor(e)
      if (command) {
        e.preventDefault()
        if (command === 'toggleKept' && e.repeat) return
        void window.electronAPI.sendWindowCommand(command).catch((error) => {
          recordOperationalDiagnostic('Failed to hand a shortcut to the main window', error, { command })
        })
        return
      }
      const key = listKeyFor(e)
      if (!key) return
      e.preventDefault()
      if ((key === 'remove' || key === 'delete') && (!readyTask || readyTask !== snapshot?.task)) return
      void window.electronAPI.sendListKey(key, snapshot?.task?.taskId ?? null).catch((error) => {
        recordOperationalDiagnostic('Failed to hand a key to the main window', error, { key })
      })
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [snapshot, readyTask])

  return (
    <main className="preview-window">
      <Preview task={snapshot?.task ?? null} onReadyToAct={setReadyTask} />
      <SurfaceConfirmHost />
    </main>
  )
}
