import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nContext'
import { DRAFT_SURFACE_NAMES, type QuitQuestion } from '../../../shared/quit'
import './QuitFailureApp.css'
import { APP_NAME } from '../../../shared/app-identity'

// The quit window's page: either the question before quit stops live work, or
// the Retry / Quit anyway / Cancel question after a required save failed. Main
// owns which; the page reads it once and reports its height to be sized.
export function QuitFailureApp(): React.JSX.Element | null {
  const { t, locale } = useI18n()
  const root = useRef<HTMLElement>(null)
  const [question, setQuestion] = useState<QuitQuestion | null>(null)

  useEffect(() => {
    void window.electronAPI.getQuitQuestion().then((asked) => setQuestion(asked ?? { kind: 'saveFailed' }))
      .catch(() => setQuestion({ kind: 'saveFailed' }))
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') window.electronAPI.chooseQuit('cancel') }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])

  useEffect(() => {
    if (!question) return
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
    return () => window.removeEventListener('load', measure)
  }, [question])

  if (!question) return null
  if (question.kind === 'saveFailed') {
    return <main ref={root} className="quit-failure-app">
      <div className="quit-failure-body"><p>{t('quit.message')}</p></div>
      <footer>
        <button className="modal-btn" autoFocus onClick={() => window.electronAPI.chooseQuit('cancel')}>{t('common.cancel')}</button>
        <button className="modal-btn" onClick={() => window.electronAPI.chooseQuit('retry')}>{t('common.retry')}</button>
        <button className="modal-btn modal-btn-danger" onClick={() => window.electronAPI.chooseQuit('quit')}>{t('quit.quitAnyway')}</button>
      </footer>
    </main>
  }

  const { work } = question
  const dialogs = new Intl.ListFormat(locale, { type: 'conjunction' }).format(work.drafts.map((surface) => t(DRAFT_SURFACE_NAMES[surface])))
  return <main ref={root} className="quit-failure-app">
    <div className="quit-failure-body">
      {work.generating > 0 && <p>{t('quit.generating', { count: work.generating })}</p>}
      {work.elaborating && <p>{t('quit.elaborating')}</p>}
      {work.tools && <p>{t('quit.tools')}</p>}
      {work.drafts.length > 0 && <p>{t('quit.drafts', { dialogs })}</p>}
    </div>
    <footer>
      <button className="modal-btn" autoFocus onClick={() => window.electronAPI.chooseQuit('cancel')}>{t('common.cancel')}</button>
      <button className="modal-btn modal-btn-danger" onClick={() => window.electronAPI.chooseQuit('quit')}>
        {t(question.platform === 'darwin' ? 'statusIcon.quit' : 'statusIcon.exit', { app: APP_NAME })}
      </button>
    </footer>
  </main>
}
