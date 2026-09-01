import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
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
// toggles and stays open. Both popup levels are portalled to the viewport and
// collision-positioned there, beyond any pane's clipping boundary. Mirrors
// tapebox's Menu, hand-rolled on the renderer's own imeGuard — not imported
// across apps.

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
// submenus) closes the whole chain after a command runs. `activeSubmenu` makes
// the open submenu single: a menu with two of them would otherwise leave both
// popups on screen, overlapping, because each held its own local flag.
const MenuContext = createContext<{
  closeAll: () => void
  activeSubmenu: string | null
  setActiveSubmenu: (id: string | null) => void
  overlayOwner: string
} | null>(null)

type PopupPosition = {
  left: number
  top: number
}

const VIEWPORT_GUTTER = 8
const ROOT_MENU_GAP = 4

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

function rootMenuPosition(anchor: DOMRect, popup: DOMRect): PopupPosition {
  const maximumLeft = window.innerWidth - VIEWPORT_GUTTER - popup.width
  const below = anchor.bottom + ROOT_MENU_GAP
  const above = anchor.top - ROOT_MENU_GAP - popup.height
  const maximumTop = window.innerHeight - VIEWPORT_GUTTER - popup.height

  return {
    left: clamp(anchor.left, VIEWPORT_GUTTER, maximumLeft),
    top: clamp(below <= maximumTop ? below : above, VIEWPORT_GUTTER, maximumTop),
  }
}

function submenuPosition(anchor: DOMRect, popup: DOMRect): PopupPosition {
  const maximumLeft = window.innerWidth - VIEWPORT_GUTTER - popup.width
  const maximumTop = window.innerHeight - VIEWPORT_GUTTER - popup.height
  const right = anchor.right
  const left = anchor.left - popup.width

  return {
    left: right <= maximumLeft ? right : clamp(left, VIEWPORT_GUTTER, maximumLeft),
    top: clamp(anchor.top, VIEWPORT_GUTTER, maximumTop),
  }
}

function isOwnedOverlayTarget(target: Node, owner: string): boolean {
  let element: Element | null = target instanceof Element ? target : target.parentElement
  while (element) {
    if (element.getAttribute('data-menu-overlay-owner') === owner) return true
    element = element.parentElement
  }
  return false
}

function usePopupPosition(
  open: boolean,
  anchorRef: React.RefObject<HTMLElement | null>,
  popupRef: React.RefObject<HTMLElement | null>,
  calculate: (anchor: DOMRect, popup: DOMRect) => PopupPosition,
): PopupPosition | null {
  const [position, setPosition] = useState<PopupPosition | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }

    const update = (): void => {
      const anchor = anchorRef.current
      const popup = popupRef.current
      if (!anchor || !popup) return
      setPosition(calculate(anchor.getBoundingClientRect(), popup.getBoundingClientRect()))
    }

    update()
    window.addEventListener('resize', update)
    // A fixed popup must follow its anchor if any enclosing app surface scrolls.
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, anchorRef, popupRef, calculate])

  return position
}

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
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const overlayOwner = useId()
  const position = usePopupPosition(open, triggerRef, contentRef, rootMenuPosition)

  const close = useCallback((focusTrigger = true): void => {
    setOpen(false)
    setActiveSubmenu(null)
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
      if (
        contentRef.current?.contains(t) ||
        triggerRef.current?.contains(t) ||
        isOwnedOverlayTarget(t, overlayOwner)
      ) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, overlayOwner])

  // Escape closes from ANYWHERE, the symmetric half of the outside-click handler
  // above. The popup's own onKeyDown only sees keys aimed at the menu, so an open
  // menu whose focus had moved elsewhere ignored Escape entirely while a click
  // still dismissed it — the one dismissable surface in the app that did not
  // answer Escape.
  //
  // `defaultPrevented` is this listener's version of the containment check above:
  // the click handler refuses events that belong to the menu, and a GLOBAL key
  // handler must likewise refuse a key another surface has already claimed —
  // otherwise it closes a menu sitting under anything that handles Escape itself.
  // (A nested Escape needs no help from it: Submenu calls stopPropagation, so the
  // native event never reaches document and one Escape closes one level.)
  //
  // Focus is deliberately NOT pulled back to the trigger here: the key came from
  // somewhere else, and yanking the caret out of whatever the user was typing in
  // would be a worse surprise than the menu closing quietly.
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (isComposing()) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, isComposing])

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
      {open && createPortal(
        <div
          ref={contentRef}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className={className ?? 'dropdown-menu'}
          data-menu-overlay-owner={overlayOwner}
          style={{
            position: 'fixed',
            left: position?.left,
            top: position?.top,
            visibility: position ? 'visible' : 'hidden',
          }}
        >
          <MenuContext.Provider
            value={{ closeAll: () => close(), activeSubmenu, setActiveSubmenu, overlayOwner }}
          >
            {children}
          </MenuContext.Provider>
        </div>,
        document.body,
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
  disabled = false,
}: {
  onSelect: () => void
  children: ReactNode
  // A disabled item stays VISIBLE rather than being dropped from the menu: the
  // reader learns the action exists and why it is unavailable (the label carries
  // the count), and the menu's shape does not shift under the cursor as counts
  // change. It keeps aria-disabled, so assistive tech reads it the same way.
  disabled?: boolean
}): React.JSX.Element {
  const ctx = useContext(MenuContext)
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className="menu-item"
      disabled={disabled}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (disabled) return
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
//
// The box is a real, display-only native checkbox — the same control the settings panel
// uses — so it matches that style exactly (filled accent box + check when on, bordered box
// when off) and follows the theme/OS accent for free. The button carries the real
// aria-checked; the input is aria-hidden, unfocusable, and pointer-transparent so the click
// always lands on the button (which calls onToggle). `readOnly` because it is driven by the
// button, not by its own change event.
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
      <span className="menu-check-mark" aria-hidden="true">
        <input type="checkbox" checked={checked} readOnly tabIndex={-1} />
      </span>
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
  const id = useId()
  // Openness is the PARENT menu's state, not this component's, so opening one
  // submenu closes its siblings. The local flag is only the fallback for a
  // Submenu rendered outside a Menu, where there are no siblings to conflict.
  const [localOpen, setLocalOpen] = useState(false)
  const open = ctx ? ctx.activeSubmenu === id : localOpen
  const setOpen = (next: boolean): void => {
    if (ctx) ctx.setActiveSubmenu(next ? id : null)
    else setLocalOpen(next)
  }
  const parentRef = useRef<HTMLButtonElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const position = usePopupPosition(open, parentRef, popupRef, submenuPosition)

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
        {/* Drawn, not typed — and drawn from the one icon set, so this
            chevron can never drift from the app's other chevrons. */}
        <Icon name="chevron-right" className="menu-submenu-arrow" />
      </button>
      {open && createPortal(
        <div
          ref={popupRef}
          role="menu"
          aria-label={label}
          className="menu-submenu"
          onKeyDown={onPopupKeyDown}
          data-menu-overlay-owner={ctx?.overlayOwner}
          style={{
            position: 'fixed',
            left: position?.left,
            top: position?.top,
            visibility: position ? 'visible' : 'hidden',
          }}
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  )
}
