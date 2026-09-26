import { Modal } from './Modal'
import { Icon } from './Icon'
import { InlineFailureResult } from './InlineFailureResult'
import { useExternalLinkResults } from '../hooks/useExternalLinkResults'
import { useI18n } from '../i18n/I18nContext'

interface Props {
  onClose: () => void
}

export function AboutModal({ onClose }: Props): React.JSX.Element {
  const { t } = useI18n()
  const links = useExternalLinkResults()
  const openLink = (key: 'github' | 'issues', url: string): void => {
    void links.open({
      key,
      url,
      message: key === 'github' ? 'about.githubFailed' : 'about.issuesFailed',
      diagnosticMessage: 'Failed to open an About link',
    })
  }

  return (
    <Modal
      title={t('nativeMenu.about', { app: 'ImageQueue' })}
      titleHidden
      onClose={onClose}
      footer={
        <button className="modal-btn" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="about-content">
        <div className="about-name">ImageQueue</div>
        <p className="about-version">{t('about.version', { version: __APP_VERSION__ })}</p>
        <p className="about-desc">{t('about.description')}</p>
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
            {t('about.reportIssue')} <Icon name="external-link" />
          </a>
        </div>
        {Object.entries(links.results).map(([key, message]) => message ? (
          <InlineFailureResult
            key={key}
            message={t(message)}
            closeLabel={t(key === 'github' ? 'about.closeGithubResult' : 'about.closeIssuesResult')}
            onClose={() => links.dismiss(key)}
          />
        ) : null)}
        <p className="about-copyright">
          {t('about.copyright', { year: '2026', author: 'Yoshinao Inoguchi', license: 'GNU GPL v3' })}
        </p>
      </div>
    </Modal>
  )
}
