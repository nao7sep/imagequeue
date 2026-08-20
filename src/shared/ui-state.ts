// Ephemeral UI state — what the app remembers on the user's behalf, distinct from
// config.json (user-authored settings) and dependencies.json (the check cache).
// Persisted to ~/.imagequeue/state.json, its own store and type per the
// persisted-store-separation conventions: a settings reset must not touch it, and
// its splitter-drag churn must never rewrite the config file. Disposable — losing
// it just restores the default pane width.

import {
  COLUMN_DEFAULT_PX,
  COLUMN_MIN_PX,
  LEFT_PANE_MIN_PX,
  PANE_BORDER_PX,
  PANE_TOOLBAR_MIN_PX,
  PROMPT_REGION_MIN_PX,
} from './layout-metrics'

export interface UiState {
  /**
   * The per-provider queue-column width the user dragged to, in CSS px (the
   * INTENT). `null` means never set — columns open at COLUMN_DEFAULT_PX, the width
   * that holds a column's longest real row without clipping. The DISPLAYED width is
   * derived from this intent and the live window (displayedColumnWidth): the intent
   * is clamped to what fits so a narrow window can't clip the columns, but the
   * stored value is not, so a wide layout survives a narrow reopen and returns when
   * the window grows.
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
 * The left-pane width past which extra window width serves nobody: the width at
 * which the preview renders square. The preview region's height is the container
 * minus the fixed toolbar and prompt regions — the same derivation that opens
 * the window with a square preview (computeWindowDefaultHeight, inverted).
 * Floored at the pane's minimum so a short window cannot push comfort below it.
 */
export function leftPaneComfortWidth(containerHeight: number): number {
  return Math.max(LEFT_PANE_MIN_PX, containerHeight - PANE_TOOLBAR_MIN_PX - PROMPT_REGION_MIN_PX)
}

/**
 * The per-column width to render: the stored intent (defaulting to
 * COLUMN_DEFAULT_PX when unset or invalid), floored at COLUMN_MIN_PX and capped at
 * what the container can show. Pure so the splitter, the render, and the tests all
 * agree. On a window too narrow to grant the default, the cap wins and columns show
 * narrower — the intent is untouched, so widening the window restores it.
 *
 * `containerHeight`, when known, turns the intent into a FLOOR on a wide window:
 * the left pane is flex, so without this it absorbed every surplus pixel and the
 * preview grew sideways without limit. Once the left pane would exceed its
 * comfort width (a square preview), the surplus flows into the columns instead —
 * the splitter's manual escape, made the default. Dragging still works: wider
 * than the automatic width wins immediately; narrower is remembered in the
 * intent and takes effect when the window no longer has surplus to distribute.
 */
export function displayedColumnWidth(
  intent: number | null,
  containerWidth: number,
  visibleCount: number,
  containerHeight: number | null = null,
): number {
  const wanted =
    intent != null && Number.isFinite(intent) ? Math.max(COLUMN_MIN_PX, Math.round(intent)) : COLUMN_DEFAULT_PX
  const cap = maxColumnWidthForContainer(containerWidth, visibleCount)
  if (containerHeight == null || !Number.isFinite(containerWidth) || visibleCount <= 0) {
    return Math.min(wanted, cap)
  }
  const borders = visibleCount * PANE_BORDER_PX
  const surplusShare = Math.floor(
    (containerWidth - leftPaneComfortWidth(containerHeight) - borders) / visibleCount,
  )
  return Math.min(Math.max(wanted, surplusShare), cap)
}
