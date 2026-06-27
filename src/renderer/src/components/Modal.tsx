import { createPortal } from 'react-dom'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { isTopmostModal, popModal, pushModal } from './modalStack'
import './Modal.css'

interface ModalProps {
  title?: string
  onClose: () => void
  className?: string
  children: ReactNode
  /**
   * Footer action row. The shell renders it as a fixed band below the body, so
   * a long scrolling body never pushes the Close/Cancel path out of reach. Pass
   * the buttons (and any leading status) directly; the shell owns the band.
   */
  footer?: ReactNode
  closeOnBackdropClick?: boolean
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

export function Modal({
  title,
  onClose,
  className,
  children,
  footer,
  closeOnBackdropClick = true
}: ModalProps): React.JSX.Element {
  const modalId = useId()
  const titleId = `${modalId}-title`
  const boxRef = useRef<HTMLDivElement>(null)

  // Capture the focus-restore target during the first render, before commit
  // moves focus (a child's `autoFocus`, or our own focus-on-open) — otherwise we
  // would "restore" to an element inside the modal itself.
  const [restoreTarget] = useState<HTMLElement | null>(
    () => document.activeElement as HTMLElement | null
  )

  // Register in the modal stack (drives topmost routing) and, on close, return
  // focus to the element that held it before we opened — but only if it is still
  // in the document (a menu item that triggered us may have since unmounted).
  useEffect(() => {
    pushModal(modalId)
    return () => {
      popModal(modalId)
      if (restoreTarget?.isConnected) restoreTarget.focus()
    }
  }, [modalId, restoreTarget])

  // On open, land focus inside the modal — unless a child already claimed it
  // (e.g. an `autoFocus` default action). Fall back to the dialog surface so
  // focus never sits behind the backdrop.
  useEffect(() => {
    const box = boxRef.current
    if (!box || box.contains(document.activeElement)) return
    const focusable = getFocusable(box)
    ;(focusable[0] ?? box).focus()
  }, [])

  // Topmost-only keyboard ownership: Escape closes through onClose; Tab and
  // Shift+Tab are trapped inside the box so focus can never reach the window
  // behind it. Capture phase so we win over bubbling app handlers.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (!isTopmostModal(modalId)) return

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }

      if (e.key === 'Tab') {
        const box = boxRef.current
        if (!box) return
        const focusable = getFocusable(box)
        if (focusable.length === 0) {
          e.preventDefault()
          box.focus()
          return
        }
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || !box.contains(active))) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && (active === last || !box.contains(active))) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [modalId, onClose])

  const content = (
    <div
      className="modal-backdrop"
      data-modal-id={modalId}
      onClick={() => {
        if (!isTopmostModal(modalId) || !closeOnBackdropClick) return
        onClose()
      }}
    >
      <div
        ref={boxRef}
        className={className ? `modal-box ${className}` : 'modal-box'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title !== undefined ? titleId : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {title !== undefined && (
          <div className="modal-header">
            <span id={titleId}>{title}</span>
            <button className="modal-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        )}
        {children}
        {footer !== undefined && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
