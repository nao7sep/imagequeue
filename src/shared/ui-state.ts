// Ephemeral UI state — what the app remembers on the user's behalf, distinct from
// config.json (user-authored settings) and dependencies.json (the check cache).
// Persisted to ~/.imagequeue/state.json, its own store and type per the
// persisted-store-separation conventions: a settings reset must not touch it, and
// its splitter-drag churn must never rewrite the config file. Disposable — losing
// it just restores the default pane width.

import { COLUMN_MIN_PX, LEFT_PANE_MIN_PX, PANE_BORDER_PX } from './layout-metrics'

export interface UiState {
  /**
   * The per-provider queue-column width the user dragged to, in CSS px (the
   * INTENT). `null` means never set — columns sit at their COLUMN_MIN_PX floor,
   * the pre-splitter look. The DISPLAYED width is derived from this intent and the
   * live window (displayedColumnWidth): the intent is clamped to what fits so a
   * narrow window can't clip the columns, but the stored value is not, so a wide
   * layout survives a narrow reopen and returns when the window grows.
   */
  columnWidth: number | null
}

export function defaultUiState(): UiState {
  return { columnWidth: null }
}

/**
 * The widest a single column may display while the left pane keeps its minimum:
 * the space left after the left-pane minimum and the inter-pane borders (one per
 * visible column: left-pane↔group plus between each adjacent pair), divided among
 * the visible columns. Never below COLUMN_MIN_PX — at the window minimum this is
 * exactly the floor.
 */
export function maxColumnWidthForContainer(containerWidth: number, visibleCount: number): number {
  if (visibleCount <= 0) return COLUMN_MIN_PX
  const borders = visibleCount * PANE_BORDER_PX
  const usable = containerWidth - LEFT_PANE_MIN_PX - borders
  return Math.max(COLUMN_MIN_PX, Math.floor(usable / visibleCount))
}

/**
 * The per-column width to render: the stored intent (defaulting to the floor when
 * unset or invalid), floored at COLUMN_MIN_PX and capped at what the container can
 * show. Pure so the splitter, the render, and the tests all agree.
 */
export function displayedColumnWidth(
  intent: number | null,
  containerWidth: number,
  visibleCount: number,
): number {
  const wanted =
    intent != null && Number.isFinite(intent) ? Math.max(COLUMN_MIN_PX, Math.round(intent)) : COLUMN_MIN_PX
  return Math.min(wanted, maxColumnWidthForContainer(containerWidth, visibleCount))
}
