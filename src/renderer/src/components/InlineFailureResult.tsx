import { Icon } from './Icon'
import './InlineFailureResult.css'
import { useI18n } from '../i18n/I18nContext'

export function InlineFailureResult({ message, closeLabel, onClose }: {
  message: string
  closeLabel: string
  onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <div className="inline-failure-result" role="alert">
      <span>{message}</span>
      <button type="button" aria-label={closeLabel} title={t('common.close')} onClick={onClose}>
        <Icon name="close" />
      </button>
    </div>
  )
}
