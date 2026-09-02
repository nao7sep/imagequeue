import { useEffect } from 'react'
import { STARTUP_FAILURE_TITLE } from '../../../shared/startup-failure'
import './StartupFailureApp.css'

/** Plain fatal-startup surface used when the main application cannot be initialized. */
export function StartupFailureApp({ message }: { message: string }): React.JSX.Element {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') window.close()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('keydown', closeOnEscape) }
  }, [])

  return (
    <main className="startup-failure-app">
      <h1>{STARTUP_FAILURE_TITLE}</h1>
      <p>{message}</p>
      <footer>
        <button autoFocus onClick={() => window.close()}>Close</button>
      </footer>
    </main>
  )
}
