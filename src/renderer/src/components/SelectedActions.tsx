import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import { Menu } from './Menu'
import { useI18n } from '../i18n/I18nContext'

/** One keyboard entry to a selected row's pointer actions, outside its list. */
export function SelectedActions({ triggerRef, disabled, children }: {
  triggerRef: RefObject<HTMLButtonElement | null>
  disabled: boolean
  children: ReactNode
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <Menu label={t('common.actions')} trigger={({ ref, ...props }) => (
      <button
        {...props}
        ref={(element) => { ref(element); triggerRef.current = element }}
        type="button"
        className="modal-btn"
        disabled={disabled}
      >
        {t('common.actions')}
      </button>
    )}>
      {children}
    </Menu>
  )
}

/** Context-menu keys enter the same menu as its visible trigger. */
export function openSelectedActions(event: KeyboardEvent, triggerRef: RefObject<HTMLButtonElement | null>): boolean {
  if (event.defaultPrevented || event.repeat || event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return false
  if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return false
  event.preventDefault()
  event.stopPropagation()
  triggerRef.current?.click()
  return true
}
