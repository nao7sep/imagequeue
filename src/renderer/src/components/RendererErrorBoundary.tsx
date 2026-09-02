import { Component, type ErrorInfo, type ReactNode } from 'react'
import { serializeError } from '../../../shared/serialize-error'

interface Props { children: ReactNode }
interface State { failed: boolean }

/** Last-resort renderer owner: never project a render exception into Chromium UI. */
export class RendererErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    try {
      void window.electronAPI.appLog('error', 'Renderer stopped unexpectedly', {
        error: serializeError(error),
        componentStack: info.componentStack ?? '',
      }).catch((logError) => console.error('Failed to record renderer failure', logError))
    } catch (logError) {
      console.error('Failed to record renderer failure', logError)
    }
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <main className="renderer-failure" role="alert">
        <div className="renderer-failure-card">
          <h1>ImageQueue could not keep this window open.</h1>
          <p>Reload the window to recover. Your saved sessions and generated images are unchanged.</p>
          <button type="button" onClick={() => window.location.reload()}>Reload window</button>
        </div>
      </main>
    )
  }
}
