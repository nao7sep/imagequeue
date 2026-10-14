import type { WindowCommand } from '../../../shared/viewing'

// navigator.platform is deprecated but still reliable in Electron's renderer.
const isApplePlatform = /Mac|iPhone|iPad|iPod/.test(
  typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent
)

/** Alt is excluded because Chromium delivers Windows AltGr as Ctrl+Alt. */
export function hasMod(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey
}

/**
 * On macOS, Ctrl inside a text field belongs to the text system whatever the
 * key is, so the Ctrl half of a dual-bound chord stands down there — one
 * blanket test, no per-chord key list (keyboard-shortcut-conventions). The
 * Cmd half is the binding and always fires.
 */
export function shadowsMacTextBinding(e: KeyboardEvent): boolean {
  return isApplePlatform && e.ctrlKey && !e.metaKey
}

/**
 * One editable-target predicate for the whole app. The parentElement walk is
 * load-bearing: a rich-text editor's event target is a DIV descendant of the
 * contenteditable, so a tagName-only test would let every chord through.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  let current = target instanceof HTMLElement ? target : null
  while (current) {
    if (current.isContentEditable) return true
    if (current.tagName === 'TEXTAREA') return true
    if (current.tagName === 'INPUT') {
      const type = (current.getAttribute('type') ?? 'text').toLowerCase()
      return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file'].includes(type)
    }
    current = current.parentElement
  }
  return false
}

/** The window-level shortcut a keystroke stands for, read the same way in the
 *  main window and in the preview window that hands it on. Escape clears the
 *  selection whatever modifiers are held, as it always has. */
export function windowCommandFor(e: KeyboardEvent): WindowCommand | null {
  if (e.key === 'Escape') return 'clear'
  if (!hasMod(e)) return null
  if (e.key === 'Enter') return 'sendAll'
  if (e.key === ',') return 'settings'
  if (e.key === '/') return 'shortcuts'
  const key = e.key.toLowerCase()
  if (e.shiftKey && key === 'k') return 'toggleKept'
  if (key === 'p') return 'paste'
  if (e.key >= '1' && e.key <= '9') return `send:${e.key}` as WindowCommand
  return null
}

