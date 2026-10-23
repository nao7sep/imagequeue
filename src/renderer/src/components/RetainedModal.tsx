import { useState, type ReactNode } from 'react'
import type { MessageKey } from '../../../shared/i18n/catalogues'
import { useI18n } from '../i18n/I18nContext'

export type RetainedModalState = 'pending' | 'failed' | null
export interface RetainedModalProps {
  onClose: () => void
  visible?: boolean
  retain?: (state: RetainedModalState) => void
}

/** A hidden editor keeps its submitted draft and physical operation. Its modal
 * unmounts separately, releasing focus and keyboard ownership. */
export function RetainedModal({ open, titleKey, onOpen, onClose, children }: {
  open: boolean
  titleKey: MessageKey
  onOpen: () => void
  onClose: () => void
  children: (props: RetainedModalProps) => ReactNode
}): React.JSX.Element {
  const [state, retain] = useState<RetainedModalState>(null)
  const { t } = useI18n()
  return <>
    {!open && state && <button type="button" className="retained-modal-pointer" onClick={onOpen}>
      {t(state === 'pending' ? 'settings.pendingPointer' : 'settings.failedPointer', { title: t(titleKey) })}
    </button>}
    {(open || state) && children({ visible: open, retain, onClose })}
  </>
}
