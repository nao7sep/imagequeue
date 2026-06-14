import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { nextIndex } from '../utils/compositeNav'
import { useImeGuard } from '../utils/imeGuard'

// The app's in-app menu layer (hamburger menu): a trigger plus a popup list of
// commands that behaves like a real menu per the composite-control conventions.
// The trigger is the single tab stop (aria-haspopup / aria-expanded); opening
// moves focus into the menu (first item) and closing returns it to the trigger;
// Up/Down move between items (stopping at the ends), Home/End jump, type-ahead
// jumps by label (IME-guarded), Enter/Space activate and close, and Escape / Tab
// / outside click close. Items are `menuitem`s navigated by the arrows, never by
// Tab. A Submenu parent opens on Right and closes on Left/Esc; a MenuCheckboxItem
// toggles and stays open. Mirrors tapebox's Menu, hand-rolled on the renderer's
// own imeGuard — not imported across apps.

type TriggerProps = {
  ref: (el: HTMLButtonElement | null) => void
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
  onClick: () => void
}

type Props = {
  label: string
  trigger: (props: TriggerProps) => ReactNode
  children: ReactNode
  className?: string
}

// `close` returns focus to the menu's trigger; `closeAll` (provided to nested
// submenus) closes the whole chain after a command runs.
const MenuContext = createContext<{ closeAll: () => void } | null>(null)

// Collect the menuitems that belong directly to a given menu container, excluding
// any nested inside a submenu popup (those belong to that submenu's own group).
// A submenu parent is wrapped in an anchor div, so a direct-child selector won't
// do — instead keep only items whose nearest [role="menu"] ancestor is this one.
function ownMenuItems(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  return Array.from(container.querySelectorAll<HTMLElement>('[role^="menuitem"]')).filter(
    (el) => el.closest('[role="menu"]') === container,
  )
}

function moveByArrow(items: HTMLElement[], e: KeyboardEvent, isComposing: ReturnType<typeof useImeGuard>): boolean {
  if (items.length === 0) return false
  const current = items.indexOf(document.activeElement as HTMLElement)
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    items[nextIndex('next', current, items.length)]?.focus()
    return true
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    items[nextIndex('prev', current, items.length)]?.focus()
    return true
  }
  if (e.key === 'Home') {
    e.preventDefault()
    items[0]?.focus()
    return true
  }
  if (e.key === 'End') {
    e.preventDefault()
    items[items.length - 1]?.focus()
    return true
  }
  if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && !isComposing(e.nativeEvent)) {
    const ch = e.key.toLowerCase()
    const from = Math.max(0, current)
    const order = [...items.slice(from + 1), ...items.slice(0, from + 1)]
    order.find((el) => el.textContent?.trim().toLowerCase().startsWith(ch))?.focus()
    return true
  }
  return false
}

export function Menu({ label, trigger, children, className }: Props): React.JSX.Element {
  const isComposing = useImeGuard()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)

  const close = useCallback((focusTrigger = true): void => {
    setOpen(false)
    if (focusTrigger) triggerRef.current?.focus()
  }, [])

  // On open, move focus into the menu (first item).
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => ownMenuItems(contentRef.current)[0]?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  // Outside click closes without yanking focus back (a pointer interaction).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (contentRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      close()
      return
    }
    moveByArrow(ownMenuItems(contentRef.current), e, isComposing)
  }

  return (
    <div className="menu-anchor">
      {trigger({
        ref: (el) => {
          triggerRef.current = el
        },
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        onClick: () => setOpen((v) => !v),
      })}
      {open && (
        <div
          ref={contentRef}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className={className ?? 'dropdown-menu'}
        >
          <MenuContext.Provider value={{ closeAll: () => close() }}>{children}</MenuContext.Provider>
        </div>
      )}
    </div>
  )
}

// One command in a Menu: a `menuitem` reachable only by the menu's arrow
// navigation (never its own tab stop). Activating it runs the action and closes
// the whole menu, returning focus to the trigger.
export function MenuItem({
  onSelect,
  children,
}: {
  onSelect: () => void
  children: ReactNode
}): React.JSX.Element {
  const ctx = useContext(MenuContext)
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className="menu-item"
      onClick={() => {
        ctx?.closeAll()
        onSelect()
      }}
    >
      {children}
    </button>
  )
}

// A checkable command: `menuitemcheckbox` with `aria-checked`. Toggling it runs
// the action and leaves the menu open, so the user can flip it and keep working.
export function MenuCheckboxItem({
  checked,
  onToggle,
  children,
}: {
  checked: boolean
  onToggle: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      tabIndex={-1}
      className="menu-item menu-checkbox-item"
      onClick={onToggle}
    >
      <span className="menu-check-mark" aria-hidden="true">{checked ? '✓' : ''}</span>
      <span>{children}</span>
    </button>
  )
}

// A submenu: its parent is a `menuitem` carrying aria-haspopup / aria-expanded
// that opens the nested popup on Right (or Enter/Space) and closes it on Left /
// Esc, returning focus to the parent. The nested popup is its own roving-focus
// group with the same Up/Down/Home/End/type-ahead handling.
export function Submenu({
  label,
  children,
}: {
  label: string
  children: ReactNode
}): React.JSX.Element {
  const ctx = useContext(MenuContext)
  const isComposing = useImeGuard()
  const [open, setOpen] = useState(false)
  const parentRef = useRef<HTMLButtonElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)

  const openSubmenu = (): void => {
    setOpen(true)
    requestAnimationFrame(() => ownMenuItems(popupRef.current)[0]?.focus())
  }

  const closeSubmenu = (focusParent = true): void => {
    setOpen(false)
    if (focusParent) parentRef.current?.focus()
  }

  const onParentKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
      if ((e.key === 'Enter' || e.key === ' ') && isComposing(e.nativeEvent)) return
      e.preventDefault()
      e.stopPropagation()
      openSubmenu()
    }
  }

  const onPopupKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowLeft' || e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeSubmenu()
      return
    }
    // Tab from inside a submenu closes the entire menu (a menu is never tabbed).
    if (e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      ctx?.closeAll()
      return
    }
    // Keep arrow / type-ahead handling local so the parent menu's handler doesn't
    // also act on the same key.
    if (moveByArrow(ownMenuItems(popupRef.current), e, isComposing)) e.stopPropagation()
  }

  return (
    <div className="menu-submenu-anchor">
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        tabIndex={-1}
        ref={parentRef}
        className="menu-item menu-submenu-parent"
        onClick={() => (open ? closeSubmenu() : openSubmenu())}
        onKeyDown={onParentKeyDown}
      >
        <span>{label}</span>
        <span className="menu-submenu-arrow" aria-hidden="true">▸</span>
      </button>
      {open && (
        <div
          ref={popupRef}
          role="menu"
          aria-label={label}
          className="menu-submenu"
          onKeyDown={onPopupKeyDown}
        >
          {children}
        </div>
      )}
    </div>
  )
}
