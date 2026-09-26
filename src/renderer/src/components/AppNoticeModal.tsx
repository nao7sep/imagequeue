import type { AppNotice } from '../../../shared/app-notice'
import { useI18n } from '../i18n/I18nContext'
import { Modal } from './Modal'

interface Props {
  notice: AppNotice
  onClose: () => void
}

/** App-wide informational alert rendered through ImageQueue's plain modal shell. */
export function AppNoticeModal({ notice, onClose }: Props): React.JSX.Element {
  const { t, text } = useI18n()
  const title = text(notice.title)
  return (
    <Modal
      title={title}
      onClose={onClose}
      closeOnBackdropClick={false}
      footer={
        <button className="modal-btn modal-btn-primary" autoFocus onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="confirm-body" role="region" aria-label={t('common.detailsOf', { title })} tabIndex={0}>
        {text(notice.message)}
      </div>
    </Modal>
  )
}
