import { createPortal } from 'react-dom'
import { useEffect, useId, type ReactNode } from 'react'
import './Modal.css'

interface ModalProps {
  title?: string
  onClose: () => void
  className?: string
  children: ReactNode
  closeOnBackdropClick?: boolean
}

const modalStack: string[] = []

export function Modal({
  title,
  onClose,
  className,
  children,
  closeOnBackdropClick = true
}: ModalProps): React.JSX.Element {
  const modalId = useId()

  useEffect(() => {
    modalStack.push(modalId)
    return () => {
      const index = modalStack.lastIndexOf(modalId)
      if (index >= 0) modalStack.splice(index, 1)
    }
  }, [modalId])

  const isTopmost = (): boolean => modalStack[modalStack.length - 1] === modalId

  // Close on Escape only for the topmost modal, so nested confirms do not
  // also close the modal underneath them.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !isTopmost()) return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [modalId, onClose])

  const content = (
    <div
      className="modal-backdrop"
      data-modal-id={modalId}
      onClick={() => {
        if (!isTopmost() || !closeOnBackdropClick) return
        onClose()
      }}
    >
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

  return createPortal(content, document.body)
}
