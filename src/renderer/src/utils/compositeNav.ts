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
 * owns DOM focus movement, covered by the renderer interaction suites.
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
