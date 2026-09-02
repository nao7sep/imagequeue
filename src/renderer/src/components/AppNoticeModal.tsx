import type { AppNotice } from '../../../shared/app-notice'
import { Modal } from './Modal'

interface Props {
  notice: AppNotice
  onClose: () => void
}

/** App-wide informational alert rendered through ImageQueue's plain modal shell. */
export function AppNoticeModal({ notice, onClose }: Props): React.JSX.Element {
  return (
    <Modal
      title={notice.title}
      onClose={onClose}
      closeOnBackdropClick={false}
      footer={
        <button className="modal-btn modal-btn-primary" autoFocus onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="confirm-body">{notice.message}</div>
    </Modal>
  )
}
