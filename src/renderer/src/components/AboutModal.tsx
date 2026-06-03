import { Modal } from './Modal'

interface Props {
  onClose: () => void
}

export function AboutModal({ onClose }: Props): React.JSX.Element {
  return (
    <Modal title="About" onClose={onClose}>
      <div className="about-content">
        <div className="about-name">ImageQueue</div>
        <p className="about-version">Version {__APP_VERSION__}</p>
        <p className="about-desc">Multi-backend AI image generation queue.</p>
        <div className="about-links">
          <a
            href="https://github.com/nao7sep/imagequeue"
            target="_blank"
            rel="noreferrer"
            className="about-link"
          >
            GitHub ↗
          </a>
          <a
            href="https://github.com/nao7sep/imagequeue/issues"
            target="_blank"
            rel="noreferrer"
            className="about-link"
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
