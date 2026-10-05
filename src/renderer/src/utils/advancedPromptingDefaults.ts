import type { Elaborator } from '../../../shared/types'

// What Advanced Prompting shows for a choice the draft has not saved. These are
// on-screen defaults only; the draft changes when the user edits the field.

/** The seed shown: the saved seed, or the fill taken from the main prompt while
 *  the saved seed is empty and untouched. */
export function shownSeed(savedSeed: string, fill: string | null): string {
  return savedSeed || (fill ?? '')
}

/** The elaborator shown as chosen: the saved one while it still exists, else the
 *  first of its kind, or none when the kind has none. */
export function shownElaboratorId(items: readonly Elaborator[], savedId: string | null): string | null {
  if (savedId !== null && items.some((item) => item.id === savedId)) return savedId
  return items[0]?.id ?? null
}
