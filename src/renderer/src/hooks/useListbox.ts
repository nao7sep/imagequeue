import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { currentCompositeIndex, nextIndex, removalFocusTargetId } from '../utils/compositeNav'

// Roughly one viewport of rows for PageUp/PageDown. The listbox panels here are
// short single-select lists, so a fixed page step is plenty and avoids measuring
// row heights on every keystroke.
const PAGE_STEP = 8

interface UseListboxParams {
  // The option ids in their current visible order — the navigation model operates
  // on this full set, the single source of truth for order and membership.
  ids: string[]
  // The committed selection (a projection target). May be null.
  selectedId: string | null
  // Sets the selection. In 'follows-focus' mode this fires on every arrow move;
  // in 'manual' mode it fires only on click and on Enter/Space (the primary
  // action), never merely on focus.
  onSelect: (id: string) => void
  // Whether moving the active item commits it. 'follows-focus' for cheap local
  // selection (Elaborators); 'manual' for destructive/network primaries
  // (Sessions resume, Models download), where Enter/Space invokes the action.
  activation: 'follows-focus' | 'manual'
  // Optional primary action for manual lists: Enter/Space on the active row.
  // Distinct from onSelect so a manual list can move the cursor without acting.
  onPrimary?: (id: string) => void
  // Optional removal (Delete/Backspace on the active row). Recovery focus moves
  // to the neighbor that slides into place once `ids` drops the removed id.
  onRemove?: (id: string) => void
  // Type-ahead is ceded when the surrounding UI owns the letter keys (Models'
  // search inputs). Defaults to enabled.
  typeAhead?: boolean
  // IME-composition guard shared with the rest of the renderer; type-ahead and
  // Space/Enter activation ignore keystrokes made mid-composition.
  isComposing?: (event?: { isComposing?: boolean; keyCode?: number }) => boolean
}

interface OptionProps {
  role: 'option'
  'aria-selected': boolean
  tabIndex: 0 | -1
  'data-listbox-option': string
  onFocus: () => void
  onClick: () => void
}

// The container element type is a parameter so the same hook drives a list
// rendered as a <div> (Sessions, Elaborators) or a <ul> (the model lists); the
// returned `ref` matches, so spreading `listboxProps` onto the chosen element
// type-checks without a cast.
interface UseListboxResult<T extends HTMLElement> {
  listboxProps: {
    ref: React.RefObject<T | null>
    role: 'listbox'
    onKeyDown: (e: KeyboardEvent) => void
  }
  getOptionProps: (id: string) => OptionProps
}

/**
 * The app's in-app listbox layer for the single-select panels (Sessions, the
 * three Draw Things model panes, the three Elaborator panes). Returns props to
 * spread onto the list container and each row, so adopting it gives the rows the
 * composite contract (one tab stop, arrow navigation, roving tabindex, ARIA) and
 * keeps selection in app state as the single source of truth — without
 * restructuring the markup.
 *
 * One tab stop: the selected row (or the first when nothing is selected) is the
 * only tabbable option, so Tab enters the list at the active row and Tab leaves
 * it. Up/Down move the active row, Home/End and PageUp/PageDown jump, all stopping
 * at the ends. In 'follows-focus' mode moving the cursor selects; in 'manual' mode
 * Enter/Space on the active row runs the primary action. Delete/Backspace removes
 * the active row when `onRemove` is given, recovering to the neighbor. Type-ahead
 * jumps by visible label (IME-guarded), unless ceded.
 *
 * Programmatic focus from recovery is guarded: it only takes DOM focus when focus
 * already lives inside this list, per the never-steal-focus rule.
 */
export function useListbox<T extends HTMLElement = HTMLDivElement>(params: UseListboxParams): UseListboxResult<T> {
  const { ids, selectedId, onSelect, activation, onPrimary, onRemove, typeAhead = true, isComposing } = params
  const ref = useRef<T>(null)
  const activeIdRef = useRef<string | null>(selectedId && ids.includes(selectedId) ? selectedId : ids[0] ?? null)
  const [activeId, setActiveIdState] = useState<string | null>(activeIdRef.current)
  const pendingRemovalRef = useRef<{ id: string; index: number } | null>(null)
  const typeAheadRef = useRef<{ buffer: string; at: number }>({ buffer: '', at: 0 })

  // The single tab stop: the selected option, or the first when nothing in the
  // list is selected, so the list is always Tab-reachable when it has rows.
  const selectedInList = selectedId && ids.includes(selectedId) ? selectedId : null
  const tabbableId = activeId && ids.includes(activeId) ? activeId : selectedInList ?? ids[0] ?? null

  const setActiveId = useCallback((id: string | null): void => {
    activeIdRef.current = id
    setActiveIdState(id)
  }, [])

  // Whether DOM focus currently sits on one of this list's options.
  const focusWithinList = (): boolean => {
    const active = document.activeElement
    return active instanceof HTMLElement && typeof active.dataset.listboxOption === 'string'
      ? ref.current?.contains(active) ?? false
      : false
  }

  const focusOption = (id: string): void => {
    (ref.current?.querySelector(`[data-listbox-option="${CSS.escape(id)}"]`) as HTMLElement | null)?.focus()
  }

  // After a removal lands (the removed id leaves `ids`), move the cursor — and,
  // only if focus already lived in the list, DOM focus — to the recovery target.
  useEffect(() => {
    const pending = pendingRemovalRef.current
    if (!pending || ids.includes(pending.id)) return
    pendingRemovalRef.current = null
    const targetId = removalFocusTargetId(ids, pending.index)
    setActiveId(targetId)
    if (targetId && focusWithinList()) focusOption(targetId)
  }, [ids, setActiveId])

  // Keep the active cursor pointing at a live row as the list changes.
  useEffect(() => {
    if (activeIdRef.current && ids.includes(activeIdRef.current)) return
    setActiveId(selectedInList ?? ids[0] ?? null)
  }, [ids, selectedInList, setActiveId])

  // Track the committed selection as the active cursor too (so Tab returns to it).
  useEffect(() => {
    if (selectedInList && selectedInList !== activeIdRef.current) setActiveId(selectedInList)
  }, [selectedInList, setActiveId])

  const focusedId = (): string | null => {
    const active = document.activeElement
    return active instanceof HTMLElement ? active.dataset.listboxOption ?? null : null
  }

  // Move the cursor (and DOM focus) to an index; commit only when activation
  // follows focus.
  const moveTo = (index: number): void => {
    const id = ids[index]
    if (id === undefined) return
    setActiveId(id)
    focusOption(id)
    if (activation === 'follows-focus') onSelect(id)
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (ids.length === 0) return
    const current = currentCompositeIndex({
      ids,
      focusedId: focusedId(),
      activeId: activeIdRef.current,
      selectedId,
    })

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveTo(nextIndex('next', current, ids.length))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveTo(nextIndex('prev', current, ids.length))
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      moveTo(nextIndex('first', current, ids.length))
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      moveTo(nextIndex('last', current, ids.length))
      return
    }
    if (e.key === 'PageDown') {
      e.preventDefault()
      moveTo(Math.min((current < 0 ? 0 : current) + PAGE_STEP, ids.length - 1))
      return
    }
    if (e.key === 'PageUp') {
      e.preventDefault()
      moveTo(Math.max((current < 0 ? 0 : current) - PAGE_STEP, 0))
      return
    }

    if ((e.key === 'Enter' || e.key === ' ')) {
      if (isComposing?.(e.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number })) return
      const targetId = focusedId() ?? activeIdRef.current
      if (!targetId) return
      e.preventDefault()
      // Manual lists run the primary action; follows-focus lists are already
      // committed on move, so Enter re-commits/confirms the active row.
      if (activation === 'manual') onPrimary?.(targetId)
      else onSelect(targetId)
      return
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && onRemove) {
      const targetId = focusedId() ?? activeIdRef.current ?? selectedId
      const targetIndex = targetId ? ids.indexOf(targetId) : -1
      if (!targetId || targetIndex < 0) return
      e.preventDefault()
      pendingRemovalRef.current = { id: targetId, index: targetIndex }
      onRemove(targetId)
      return
    }

    // Type-ahead: jump to the next row whose visible label starts with the typed
    // run, resetting after a short idle. Ignored mid-IME-composition, and ceded
    // entirely when the surrounding UI owns the letters.
    if (typeAhead && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (isComposing?.(e.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number })) return
      const now = Date.now()
      const ta = typeAheadRef.current
      ta.buffer = now - ta.at > 600 ? e.key.toLowerCase() : ta.buffer + e.key.toLowerCase()
      ta.at = now
      const order = [...ids.slice(current + 1), ...ids.slice(0, current + 1)]
      const match = order.find((id) => {
        const el = ref.current?.querySelector(`[data-listbox-option="${CSS.escape(id)}"]`)
        return el?.textContent?.trim().toLowerCase().startsWith(ta.buffer)
      })
      if (match) {
        e.preventDefault()
        moveTo(ids.indexOf(match))
      }
    }
  }

  return {
    listboxProps: { ref, role: 'listbox', onKeyDown },
    getOptionProps: (id: string) => ({
      role: 'option',
      'aria-selected': id === selectedId,
      tabIndex: id === tabbableId ? 0 : -1,
      'data-listbox-option': id,
      onFocus: () => setActiveId(id),
      onClick: () => {
        setActiveId(id)
        onSelect(id)
      },
    }),
  }
}
