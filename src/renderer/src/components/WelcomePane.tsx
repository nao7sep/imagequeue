import './WelcomePane.css'
import { useI18n } from '../i18n/I18nContext'

interface Props {
  onOpenSettings: () => void
}

// Stands in the right-hand pane group when it would otherwise be empty: no cloud
// backend has a key, and this platform has no Draw Things column to fall back on.
// It occupies one column slot, and it is not a backend — it holds no tasks and
// takes no part in column shortcuts or selection navigation.
//
// It says nothing about Draw Things. macOS always shows that column, so this pane
// is unreachable there; the only users who see it are on a platform Draw Things
// does not run on, and offering them a Mac-only backend would be noise.
export function WelcomePane({ onOpenSettings }: Props): React.JSX.Element {
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

      </div>
    </div>
  )
}
