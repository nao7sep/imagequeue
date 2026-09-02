import { useEffect, useRef } from 'react'
import { STARTUP_FAILURE_TITLE } from '../../../shared/startup-failure'
import './StartupFailureApp.css'

/** Plain fatal-startup surface used when the main application cannot be initialized. */
export function StartupFailureApp({ message }: { message: string }): React.JSX.Element {
  const rootRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const reportMeasurement = (): void => {
      const root = rootRef.current
      if (!root) return

      // Measure an offscreen natural-flow twin, not the live 100vh flex body.
      // A live flex child already owns the provisional BrowserWindow height and
      // can retain that used height for the current layout pass even after its
      // flex rule changes. The detached twin has no definite block height, so
      // its body can only take the authored copy's actual height.
      const measure = root.cloneNode(true) as HTMLElement
      measure.dataset.measuring = 'true'
      measure.style.position = 'absolute'
      measure.style.left = '-10000px'
      measure.style.top = '0'
      measure.style.width = `${root.clientWidth || 520}px`
      measure.style.visibility = 'hidden'
      measure.style.pointerEvents = 'none'
      document.body.appendChild(measure)
      try {
        const title = measure.querySelector('h1')
        const body = measure.querySelector('p')
        const footer = measure.querySelector('footer')
        if (!(title instanceof HTMLElement) || !(body instanceof HTMLElement) || !(footer instanceof HTMLElement)) return
        const bodyStyle = getComputedStyle(body)
        const lineHeight = Number.parseFloat(bodyStyle.lineHeight) || 24
        const paddingTop = Number.parseFloat(bodyStyle.paddingTop) || 0
        const paddingBottom = Number.parseFloat(bodyStyle.paddingBottom) || 0
        window.electronAPI.reportStartupFailureMeasurement({
          naturalHeight: title.offsetHeight + body.scrollHeight + footer.offsetHeight,
          minimumHeight: title.offsetHeight + Math.ceil(lineHeight + paddingTop + paddingBottom) + footer.offsetHeight,
        })
      } finally {
        measure.remove()
      }
    }

    // The recovery window is hidden until main receives this measurement.
    // `load`, unlike React commit/DOMContentLoaded, guarantees the extracted
    // production stylesheet has landed, so the flex body is measured under its
    // real fixed-header/fixed-footer contract rather than Chromium defaults.
    if (document.readyState === 'complete') {
      reportMeasurement()
      return
    }
    window.addEventListener('load', reportMeasurement, { once: true })
    return () => window.removeEventListener('load', reportMeasurement)
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
      <h1>{STARTUP_FAILURE_TITLE}</h1>
      <p>{message}</p>
      <footer>
        <button autoFocus onClick={() => window.close()}>Close</button>
      </footer>
    </main>
  )
}
