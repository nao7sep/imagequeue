import './WelcomePane.css'
import { useI18n } from '../i18n/I18nContext'

interface Props {
  onOpenSettings: () => void
  onOpenManagedTools: () => void
}

// Setup choices occupy a pane but do not participate in backend navigation.
export function WelcomePane({ onOpenSettings, onOpenManagedTools }: Props): React.JSX.Element {
  const { t } = useI18n()
  return (
    <div className="welcome-pane">
      <div className="column-header">{t('welcome.title')}</div>
      <div className="welcome-body">
        <p className="welcome-lead">{t('welcome.lead')}</p>

        <div className="welcome-step">
          <div className="welcome-step-title">{t('welcome.addKey')}</div>
          <p>{t('welcome.addKeyBody')}</p>
          <button className="welcome-btn welcome-btn-primary" onClick={onOpenSettings}>
            {t('welcome.openSettings')}
          </button>
        </div>

        {window.electronAPI.platform === 'darwin' && (
          <div className="welcome-step">
            <div className="welcome-step-title">{t('welcome.setupDrawThings')}</div>
            <p>{t('welcome.setupDrawThingsBody')}</p>
            <button className="welcome-btn" onClick={onOpenManagedTools}>
              {t('menu.managedTools')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
