import { Modal } from './Modal'
import type { ConfirmOptions } from '../context/ConfirmContext'

interface Props {
  options: ConfirmOptions
  onSettle: (value: boolean) => void
}

export function ConfirmModal({ options, onSettle }: Props): React.JSX.Element {
  return (
    <Modal
      title={options.title ?? 'Confirm'}
      onClose={() => onSettle(false)}
      footer={
        <>
          {/* Cancel takes focus, named here rather than left to markup order: a
              confirmation exists because something could go wrong, so the action a
              reflexive Enter reaches must be the one that costs nothing. */}
          <button className="modal-btn" autoFocus onClick={() => onSettle(false)}>
            {options.cancelLabel ?? 'Cancel'}
          </button>
          <button
            className={options.danger ? 'modal-btn modal-btn-danger' : 'modal-btn modal-btn-primary'}
            onClick={() => onSettle(true)}
          >
            {options.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    >
      <div className="confirm-body">{options.message}</div>
    </Modal>
  )
}
