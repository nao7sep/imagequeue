import { Modal } from './Modal'
import { Icon } from './Icon'
import { InlineFailureResult } from './InlineFailureResult'
import { useExternalLinkResults } from '../hooks/useExternalLinkResults'

interface Props {
  onClose: () => void
}

export function AboutModal({ onClose }: Props): React.JSX.Element {
  const links = useExternalLinkResults()
  const openLink = (key: 'github' | 'issues', url: string): void => {
    void links.open({
      key,
      url,
      message: key === 'github'
        ? 'The ImageQueue GitHub page could not be opened. Try the link again.'
        : 'The ImageQueue issue page could not be opened. Try the link again.',
      diagnosticMessage: 'Failed to open an About link',
    })
  }

  return (
    <Modal
      title="About"
      onClose={onClose}
      footer={
        <button className="modal-btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="about-content">
        <div className="about-name">ImageQueue</div>
        <p className="about-version">Version {__APP_VERSION__}</p>
        <p className="about-desc">Multi-backend AI image generation queue.</p>
        <div className="about-links">
          {/* Raw target="_blank" navigation is denied by the window-open handler
              (harden-window.ts), so route external links through the OS browser
              via the IPC bridge, like the rest of the app. */}
          <a
            href="https://github.com/nao7sep/imagequeue"
            rel="noreferrer"
            className="about-link"
            onClick={(e) => {
              e.preventDefault()
              openLink('github', e.currentTarget.href)
            }}
          >
            GitHub <Icon name="external-link" />
          </a>
          <a
            href="https://github.com/nao7sep/imagequeue/issues"
            rel="noreferrer"
            className="about-link"
            onClick={(e) => {
              e.preventDefault()
              openLink('issues', e.currentTarget.href)
            }}
          >
            Report Issue <Icon name="external-link" />
          </a>
        </div>
        {Object.entries(links.results).map(([key, message]) => message ? (
          <InlineFailureResult
            key={key}
            message={message}
            closeLabel={`Close ${key} link result`}
            onClose={() => links.dismiss(key)}
          />
        ) : null)}
        <p className="about-copyright">
          &copy; 2026 Yoshinao Inoguchi &mdash; MIT License
        </p>
      </div>
    </Modal>
  )
}
