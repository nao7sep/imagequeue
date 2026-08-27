// Ephemeral UI state — what the app remembers on the user's behalf, distinct from
// config.json (user-authored settings) and dependencies.json (the check cache).
// Persisted to ~/.imagequeue/state.json, its own store and type per the
// persisted-store-separation conventions: a settings reset must not touch it, and
// its splitter-drag churn must never rewrite the config file. Disposable — losing
// it just restores the default pane width.

import {
  COLUMN_DEFAULT_PX,
  COLUMN_MAX_PX,
  COLUMN_MIN_PX,
  LEFT_PANE_MIN_PX,
  PANE_BORDER_PX,
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
  /**
   * Playback volume for the completion sounds, 0–1. State rather than config: the
   * persisted-store-separation conventions draw that line at
   * presentation-versus-setting and name volume on the state side, beside zoom and
   * pane width. Whether sounds play at all IS a setting and stays in config; how
   * loud this machine plays them is an adjustment to the here and now.
   */
  notificationVolume: number
}

export const NOTIFICATION_VOLUME_DEFAULT = 0.7

export function defaultUiState(): UiState {
  return { columnWidth: null, notificationVolume: NOTIFICATION_VOLUME_DEFAULT }
}

/**
 * The widest a single column may display while the left pane keeps its minimum:
 * the space left after the left-pane minimum and the inter-pane borders (one per
 * visible column: left-pane↔group plus between each adjacent pair), divided among
 * the visible columns and capped at COLUMN_MAX_PX. Never below COLUMN_MIN_PX — at
 * the window minimum this is exactly the floor.
 */
export function maxColumnWidthForContainer(containerWidth: number, visibleCount: number): number {
  if (visibleCount <= 0) return COLUMN_MIN_PX
  const borders = visibleCount * PANE_BORDER_PX
  const usable = containerWidth - LEFT_PANE_MIN_PX - borders
  return Math.min(COLUMN_MAX_PX, Math.max(COLUMN_MIN_PX, Math.floor(usable / visibleCount)))
}

/**
 * The per-column width to render: the stored intent (defaulting to
 * COLUMN_DEFAULT_PX when unset or invalid), clamped to the backend pane's own
 * minimum and maximum and to what the container can show. Pure so the splitter,
 * render, and tests all agree. On a narrow window the fit cap wins without
 * rewriting the intent; on a wide window the fixed-purpose columns stay at the
 * user's chosen width and the primary prompt/preview pane receives the surplus.
 */
export function displayedColumnWidth(
  intent: number | null,
  containerWidth: number,
  visibleCount: number,
): number {
  const wanted =
    intent != null && Number.isFinite(intent)
      ? Math.min(COLUMN_MAX_PX, Math.max(COLUMN_MIN_PX, Math.round(intent)))
      : COLUMN_DEFAULT_PX
  const cap = maxColumnWidthForContainer(containerWidth, visibleCount)
  return Math.min(wanted, cap)
}
