import { Modal } from './Modal'
import type { ConfirmOptions } from '../context/ConfirmContext'
import { useI18n } from '../i18n/I18nContext'

interface Props {
  options: ConfirmOptions
  onSettle: (value: boolean) => void
}

// The caller words the confirmation as it asks; the language cannot change
// while the dialog is up.
export function ConfirmModal({ options, onSettle }: Props): React.JSX.Element {
  const { t } = useI18n()
  const title = options.title ?? t('confirm.title')
  return (
    <Modal
      title={title}
      onClose={() => onSettle(false)}
      footer={
        <>
          {/* Cancel takes focus, named here rather than left to markup order: a
              confirmation exists because something could go wrong, so the action a
              reflexive Enter reaches must be the one that costs nothing. */}
          <button className="modal-btn" autoFocus onClick={() => onSettle(false)}>
            {options.cancelLabel ?? t('common.cancel')}
          </button>
          <button
            className={options.danger ? 'modal-btn modal-btn-danger-confirm' : 'modal-btn modal-btn-primary'}
            onClick={() => onSettle(true)}
          >
            {options.confirmLabel ?? t('confirm.confirm')}
          </button>
        </>
      }
    >
      <div
        className="confirm-body"
        role="region"
        aria-label={t('common.detailsOf', { title })}
        tabIndex={0}
      >
        {options.message}
      </div>
    </Modal>
  )
}
