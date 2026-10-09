import { useEffect, useRef } from 'react'
import { useI18n } from '../i18n/I18nContext'
import './QuitFailureApp.css'

export function QuitFailureApp(): React.JSX.Element {
  const { t } = useI18n()
  const root = useRef<HTMLElement>(null)
  useEffect(() => {
    const measure = (): void => {
      if (!root.current) return
      const natural = root.current.cloneNode(true) as HTMLElement
      Object.assign(natural.style, { position: 'absolute', left: '-10000px', top: '0', width: `${root.current.clientWidth}px`, maxHeight: 'none', visibility: 'hidden' })
      document.body.appendChild(natural)
      try { window.electronAPI.reportQuitHeight(natural.scrollHeight) }
      finally { natural.remove() }
    }
    if (document.readyState === 'complete') measure()
    else window.addEventListener('load', measure, { once: true })
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') window.electronAPI.chooseQuit('cancel') }
    document.addEventListener('keydown', key)
    return () => { window.removeEventListener('load', measure); document.removeEventListener('keydown', key) }
  }, [])
  return <main ref={root} className="quit-failure-app">
    <p>{t('quit.message')}</p>
    <footer>
      <button className="modal-btn" autoFocus onClick={() => window.electronAPI.chooseQuit('cancel')}>{t('common.cancel')}</button>
      <button className="modal-btn" onClick={() => window.electronAPI.chooseQuit('retry')}>{t('common.retry')}</button>
      <button className="modal-btn modal-btn-danger" onClick={() => window.electronAPI.chooseQuit('quit')}>{t('quit.quitAnyway')}</button>
    </footer>
  </main>
}
