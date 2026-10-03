// The Records window's layout: a user-adjustable list pane (filters above the
// record list), a 1px splitter, and the detail pane, which takes the rest.
// Pane sizing follows window-conventions. RecordsWindow.css mirrors these by
// value.

// The list pane's bounds. `min` still fits two filter selects side by side.
export const RECORDS_LIST_WIDTH = { min: 320, default: 380, max: 640 } as const
export const RECORDS_DETAIL_MIN_WIDTH = 420
// The splitter between the panes (.pane-splitter).
export const RECORDS_SPLITTER_PX = 1
// The filter band: 12px padding above and below a search field and two rows of
// selects (three 32px controls, 8px apart), and the line below it.
export const RECORDS_FILTERS_HEIGHT = 12 * 2 + 32 * 3 + 8 * 2 + 1
export const RECORDS_LIST_MIN_HEIGHT = 160

// Derived — do not hand-edit.
export const RECORDS_WINDOW_MIN_WIDTH = RECORDS_LIST_WIDTH.min + RECORDS_SPLITTER_PX + RECORDS_DETAIL_MIN_WIDTH
export const RECORDS_WINDOW_MIN_HEIGHT = RECORDS_FILTERS_HEIGHT + RECORDS_LIST_MIN_HEIGHT

/** A stored list width healed to the pane's bounds; anything not a number is the default. */
export function clampRecordsListWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return RECORDS_LIST_WIDTH.default
  return Math.max(RECORDS_LIST_WIDTH.min, Math.min(RECORDS_LIST_WIDTH.max, Math.round(value)))
}

/** The width the list pane shows: the dragged intent, narrowed so the detail pane
 *  keeps its minimum in the window's live width, never below the list's own minimum. */
export function displayedRecordsListWidth(intent: number, available: number): number {
  const room = available - RECORDS_SPLITTER_PX - RECORDS_DETAIL_MIN_WIDTH
  const ceiling = Math.max(RECORDS_LIST_WIDTH.min, Math.min(RECORDS_LIST_WIDTH.max, room))
  return Math.max(RECORDS_LIST_WIDTH.min, Math.min(ceiling, Math.round(intent)))
}
