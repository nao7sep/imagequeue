import { Component, type ErrorInfo, type ReactNode } from 'react'
import { serializeError } from '../../../shared/serialize-error'
import { documentTranslator } from '../i18n/I18nContext'

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
    // This boundary sits outside the language provider, so it speaks the
    // language the document last declared.
    const { t } = documentTranslator()
    return (
      <main className="renderer-failure" role="alert">
        <div className="renderer-failure-card">
          <h1>{t('rendererFailure.title')}</h1>
          <p>{t('rendererFailure.message')}</p>
          <button type="button" onClick={() => window.location.reload()}>{t('rendererFailure.reload')}</button>
        </div>
      </main>
    )
  }
}
