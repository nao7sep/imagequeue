import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { nextIndex } from '../utils/compositeNav'

// Roughly one viewport of rows for PageUp/PageDown. The listbox panels here are
// short single-select lists, so a fixed page step is plenty and avoids measuring
// row heights on every keystroke.
const PAGE_STEP = 8

export interface ListboxItems {
  count: number
  idAt: (index: number) => string
  indexOf: (id: string) => number
  findPrefix?: (prefix: string, afterIndex: number) => Promise<number> | number
}

interface ListboxOptions {
  // A paged consumer owns mounting/revealing the requested row before focus.
  onNavigate?: (id: string) => void
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
  // Type-ahead is ceded when the surrounding UI owns the letter keys (Models'
  // search inputs). Defaults to enabled.
  typeAhead?: boolean
  // IME-composition guard shared with the rest of the renderer; type-ahead and
  // Space/Enter activation ignore keystrokes made mid-composition.
  isComposing?: (event?: { isComposing?: boolean; keyCode?: number }) => boolean
}

type UseListboxParams = ListboxOptions & (
  | { ids: string[]; items?: never }
  | { items: ListboxItems; ids?: never }
)

export interface OptionProps {
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
  activeId: string | null
  listboxProps: {
    ref: React.RefObject<T | null>
    role: 'listbox'
    tabIndex: 0 | -1
    onKeyDown: (e: KeyboardEvent) => void
    onBlurCapture: (e: FocusEvent) => void
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
 * only tabbable option; while there are no rows, the listbox itself owns that tab
 * stop. Thus Tab can always reach the control, including its loading, failure,
 * and ordinary-empty states. Up/Down move the active row, Home/End and
 * PageUp/PageDown jump, all stopping at the ends. In 'follows-focus' mode moving
 * the cursor selects; in 'manual' mode Enter/Space on the active row runs the
 * primary action. Type-ahead jumps by visible label (IME-guarded), unless ceded.
 *
 * Removal is intentionally NOT handled here: a component that deletes rows owns
 * both the selection and the post-delete focus recovery itself (see
 * ElaboratedPromptsModal), keeping a single source of truth instead of letting an
 * internal cursor drift from the committed selection.
 */
export function useListbox<T extends HTMLElement = HTMLDivElement>(params: UseListboxParams): UseListboxResult<T> {
  const { ids, items, selectedId, onSelect, onNavigate, activation, onPrimary, typeAhead = true, isComposing } = params
  const model = useMemo<ListboxItems>(() => items ?? {
    count: ids!.length,
    idAt: (index) => ids![index],
    indexOf: (id) => ids!.indexOf(id),
  }, [items, ids])
  const ref = useRef<T>(null)
  const activeIdRef = useRef<string | null>(null)
  const [activeId, setActiveIdState] = useState<string | null>(() => {
    const initial = selectedId && model.indexOf(selectedId) >= 0 ? selectedId : model.count ? model.idAt(0) : null
    activeIdRef.current = initial
    return initial
  })
  const typeAheadRef = useRef<{ buffer: string; at: number }>({ buffer: '', at: 0 })
  const searchVersion = useRef(0)
  const mounted = useRef(false)
  const modelRef = useRef(model)
  modelRef.current = model
  const invalidateSearch = useCallback((): void => { searchVersion.current++ }, [])
  useEffect(() => {
    mounted.current = true
    invalidateSearch()
    return () => {
      mounted.current = false
      invalidateSearch()
    }
  }, [model, invalidateSearch])

  // Membership and the tab stop use the full indexed collection even when only
  // a page of options has DOM nodes.
  const selectedInList = selectedId && model.indexOf(selectedId) >= 0 ? selectedId : null
  const tabbableId = activeId && model.indexOf(activeId) >= 0
    ? activeId : selectedInList ?? (model.count ? model.idAt(0) : null)

  const setActiveId = useCallback((id: string | null): void => {
    activeIdRef.current = id
    setActiveIdState(id)
  }, [])

  const focusOption = (id: string): void => {
    (ref.current?.querySelector(`[data-listbox-option="${CSS.escape(id)}"]`) as HTMLElement | null)?.focus()
  }

  // Keep the active cursor pointing at a live row as the list changes.
  useEffect(() => {
    if (activeIdRef.current && model.indexOf(activeIdRef.current) >= 0) return
    setActiveId(selectedInList ?? (model.count ? model.idAt(0) : null))
  }, [model, selectedInList, setActiveId])

  // Track the committed selection as the active cursor too (so Tab returns to it).
  useEffect(() => {
    if (selectedInList && selectedInList !== activeIdRef.current) {
      invalidateSearch()
      setActiveId(selectedInList)
    }
  }, [selectedInList, setActiveId, invalidateSearch])

  const focusedId = (): string | null => {
    const active = document.activeElement
    return active instanceof HTMLElement ? active.dataset.listboxOption ?? null : null
  }

  // Move the cursor (and DOM focus) to an index; commit only when activation
  // follows focus.
  const moveTo = (index: number): void => {
    invalidateSearch()
    if (index < 0 || index >= model.count) return
    const id = model.idAt(index)
    setActiveId(id)
    if (onNavigate) onNavigate(id)
    else focusOption(id)
    if (activation === 'follows-focus') onSelect(id)
  }

  const moveToRef = useRef(moveTo)
  moveToRef.current = moveTo

  const onKeyDown = (e: KeyboardEvent): void => {
    if (model.count === 0) return
    // A paged consumer can still be mounting the last requested target. Keep
    // successive keys moving from the cursor instead of the previous DOM row.
    let current = -1
    for (const id of [onNavigate ? activeIdRef.current : focusedId(), activeIdRef.current, selectedId]) {
      if (!id) continue
      current = model.indexOf(id)
      if (current >= 0) break
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveTo(nextIndex('next', current, model.count))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveTo(nextIndex('prev', current, model.count))
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      moveTo(nextIndex('first', current, model.count))
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      moveTo(nextIndex('last', current, model.count))
      return
    }
    if (e.key === 'PageDown') {
      e.preventDefault()
      moveTo(Math.min((current < 0 ? 0 : current) + PAGE_STEP, model.count - 1))
      return
    }
    if (e.key === 'PageUp') {
      e.preventDefault()
      moveTo(Math.max((current < 0 ? 0 : current) - PAGE_STEP, 0))
      return
    }

    if ((e.key === 'Enter' || e.key === ' ')) {
      invalidateSearch()
      if (isComposing?.(e.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number })) return
      const targetId = onNavigate ? activeIdRef.current : focusedId() ?? activeIdRef.current
      if (!targetId) return
      e.preventDefault()
      // Manual lists run the primary action; follows-focus lists are already
      // committed on move, so Enter re-commits/confirms the active row.
      if (activation === 'manual') onPrimary?.(targetId)
      else onSelect(targetId)
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
      if (model.findPrefix) {
        e.preventDefault()
        const version = ++searchVersion.current
        const apply = (index: number): void => {
          if (!mounted.current || version !== searchVersion.current || modelRef.current !== model ||
            !ref.current?.contains(document.activeElement)) return
          if (index >= 0 && index < model.count) moveToRef.current(index)
        }
        const result = model.findPrefix(ta.buffer, current)
        if (typeof result === 'number') apply(result)
        else void result.then(apply)
        return
      }
      // The array consumer searches visible labels synchronously. Indexed
      // collections supply findPrefix so searching never walks unloaded ids.
      if (!ids) return
      for (let distance = 1; distance <= model.count; distance++) {
        const index = (current + distance) % model.count
        const id = model.idAt(index)
        const el = ref.current?.querySelector(`[data-listbox-option="${CSS.escape(id)}"]`)
        if (el?.textContent?.trim().toLowerCase().startsWith(ta.buffer)) {
          e.preventDefault()
          moveTo(index)
          break
        }
      }
    }
  }

  return {
    activeId: tabbableId,
    listboxProps: { ref, role: 'listbox', tabIndex: model.count === 0 ? 0 : -1, onKeyDown, onBlurCapture: invalidateSearch },
    getOptionProps: (id: string) => ({
      role: 'option',
      'aria-selected': id === selectedId,
      tabIndex: id === tabbableId ? 0 : -1,
      'data-listbox-option': id,
      onFocus: () => { invalidateSearch(); setActiveId(id) },
      onClick: () => {
        invalidateSearch()
        setActiveId(id)
        onSelect(id)
      },
    }),
  }
}
