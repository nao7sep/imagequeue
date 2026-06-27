import { Modal } from './Modal'

interface Props {
  onClose: () => void
}

export function AboutModal({ onClose }: Props): React.JSX.Element {
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
              window.electronAPI.openExternal(e.currentTarget.href)
            }}
          >
            GitHub ↗
          </a>
          <a
            href="https://github.com/nao7sep/imagequeue/issues"
            rel="noreferrer"
            className="about-link"
            onClick={(e) => {
              e.preventDefault()
              window.electronAPI.openExternal(e.currentTarget.href)
            }}
          >
            Report Issue ↗
          </a>
        </div>
        <p className="about-copyright">
          &copy; 2026 Yoshinao Inoguchi &mdash; MIT License
        </p>
      </div>
    </Modal>
  )
}
