import { useEffect } from 'react'
import { currentSessionImageUrl } from '../../../shared/image-url'
import { canShowImage, listKeyFor } from '../../../shared/viewing'
import { isAnyModalOpen } from '../components/modalStack'
import { useDecodedImage } from '../hooks/useDecodedImage'
import { useI18n } from '../i18n/I18nContext'
import { recordOperationalDiagnostic } from '../utils/operationalFailure'
import { SurfaceConfirmHost } from './SurfaceConfirmHost'
import { useSelectionSnapshot } from './useSelectionSnapshot'
import './FullscreenView.css'

// The fullscreen view's page (main/fullscreen-view.ts owns its window). It
// shows the selected image, reports each snapshot it has painted so the window
// appears only with its image drawn, and hands list keys to the main window.
export function FullscreenViewApp(): React.JSX.Element {
  const { t } = useI18n()
  const snapshot = useSelectionSnapshot()
  const task = snapshot?.task ?? null
  const url = canShowImage(task) ? currentSessionImageUrl(task!.baseName!) : null
  const image = useDecodedImage(url)

  // A snapshot without an image to show, or whose image did not load, closes
  // the view; the main process drops reports older than the latest selection.
  useEffect(() => {
    if (!snapshot) return
    if (url && image.settled !== url) return
    const painted = !!url && !image.failed
    void window.electronAPI.reportFullscreenViewPainted(snapshot.version, painted).catch((error) => {
      recordOperationalDiagnostic('Failed to report the fullscreen view paint', error, { version: snapshot.version })
    })
  }, [snapshot, url, image])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // A confirmation open here owns the keyboard.
      if (isAnyModalOpen()) return
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey
      if (plain && (e.key === 'Escape' || e.key === ' ')) {
        e.preventDefault()
        if (e.repeat) return
        void window.electronAPI.closeFullscreenView().catch((error) => {
          recordOperationalDiagnostic('Failed to close the fullscreen view', error)
        })
        return
      }
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
    <div className="fullscreen-view">
      {url && image.src && <img className="fullscreen-view-image" src={image.src} alt={t('prompt.previewAlt')} />}
      <SurfaceConfirmHost />
    </div>
  )
}
