import { useEffect, type ReactNode } from 'react'
import './Modal.css'

interface ModalProps {
  title?: string
  onClose: () => void
  className?: string
  children: ReactNode
}

export function Modal({ title, onClose, className, children }: ModalProps): React.JSX.Element {
  // Close on Escape; stop propagation so other listeners don't react to it.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={className ? `modal-box ${className}` : 'modal-box'}
        onClick={(e) => e.stopPropagation()}
      >
        {title !== undefined && (
          <div className="modal-header">
            <span>{title}</span>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
