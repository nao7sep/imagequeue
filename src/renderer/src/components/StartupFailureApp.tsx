import { useEffect, useLayoutEffect, useRef } from 'react'
import { STARTUP_FAILURE_TITLE } from '../../../shared/startup-failure'
import './StartupFailureApp.css'

/** Plain fatal-startup surface used when the main application cannot be initialized. */
export function StartupFailureApp({ message }: { message: string }): React.JSX.Element {
  const rootRef = useRef<HTMLElement | null>(null)
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  const bodyRef = useRef<HTMLParagraphElement | null>(null)
  const footerRef = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    const title = titleRef.current
    const body = bodyRef.current
    const footer = footerRef.current
    if (!root || !title || !body || !footer) return

    root.dataset.measuring = 'true'
    const bodyStyle = getComputedStyle(body)
    const lineHeight = Number.parseFloat(bodyStyle.lineHeight) || 24
    const paddingTop = Number.parseFloat(bodyStyle.paddingTop) || 0
    const paddingBottom = Number.parseFloat(bodyStyle.paddingBottom) || 0
    window.electronAPI.reportStartupFailureMeasurement({
      naturalHeight: title.offsetHeight + body.scrollHeight + footer.offsetHeight,
      minimumHeight: title.offsetHeight + Math.ceil(lineHeight + paddingTop + paddingBottom) + footer.offsetHeight,
    })
    delete root.dataset.measuring
  }, [])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') window.close()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('keydown', closeOnEscape) }
  }, [])

  return (
    <main ref={rootRef} className="startup-failure-app">
      <h1 ref={titleRef}>{STARTUP_FAILURE_TITLE}</h1>
      <p ref={bodyRef}>{message}</p>
      <footer ref={footerRef}>
        <button autoFocus onClick={() => window.close()}>Close</button>
      </footer>
    </main>
  )
}
