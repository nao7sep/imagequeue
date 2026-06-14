export type NavDirection = 'next' | 'prev' | 'first' | 'last'

/**
 * The roving-navigation index math shared by the app's in-app composite layers
 * (useListbox, and the queue board's within-column movement). Given the current
 * item index and the item count, returns the index a directional key should
 * move to.
 *
 * Stops at the ends (no wrapping — the listbox convention default). When nothing
 * is current yet (index `-1`), "next" enters at the first item and "prev" at the
 * last. Returns `-1` for an empty set. Each composite maps its own keys onto a
 * direction (a listbox uses Up/Down; the queue board also uses Left/Right for
 * cross-column movement, handled by its own geometry rather than this math) and
 * keeps the DOM focus movement, which is verified by manual QA.
 */
export function nextIndex(direction: NavDirection, current: number, length: number): number {
  if (length === 0) return -1
  switch (direction) {
    case 'next':
      return current < 0 ? 0 : Math.min(current + 1, length - 1)
    case 'prev':
      return current < 0 ? length - 1 : Math.max(current - 1, 0)
    case 'first':
      return 0
    case 'last':
      return length - 1
  }
}

export function indexOfId(ids: readonly string[], id: string | null | undefined): number {
  return id ? ids.indexOf(id) : -1
}

// Resolve the composite's current cursor index, preferring the live DOM focus,
// then the locally-tracked active item, then a possibly-stale selected prop.
// This is what lets a listbox keep navigating correctly after the selection
// prop has drifted from where focus actually sits.
export function currentCompositeIndex({
  ids,
  focusedId,
  activeId,
  selectedId,
}: {
  ids: readonly string[]
  focusedId?: string | null
  activeId?: string | null
  selectedId?: string | null
}): number {
  const focused = indexOfId(ids, focusedId)
  if (focused >= 0) return focused
  const active = indexOfId(ids, activeId)
  if (active >= 0) return active
  return indexOfId(ids, selectedId)
}

// After an item at `removedIndex` leaves the list, the id that should take focus:
// the item that slid into that index (the next neighbor), else the previous
// item, else null when the list is now empty. The general recovery policy.
export function removalFocusTargetId(
  remainingIds: readonly string[],
  removedIndex: number,
): string | null {
  return remainingIds[removedIndex] ?? remainingIds[removedIndex - 1] ?? null
}
