// Single source of truth for the main window's content-based minimum size.
//
// Per the window-chrome-conventions, the window minimum is DERIVED from the
// panes' own minimums plus fixed chrome — never a hand-typed constant that
// drifts the moment a pane changes. The values below are the pane/region
// minimums; computeWindowMinWidth/Height fold them into the window minimum the
// main process feeds to BrowserWindow.
//
// The horizontal layout is a flex left pane (prompt + preview) followed by a
// fixed-width right column of backend panes; there are no splitters, so no
// drag-clamp logic is needed. The binding horizontal dimension is therefore the
// left pane's real minimum plus one column per *visible* backend (Draw Things is
// macOS-only, so the column count is platform-dependent) plus the inter-pane
// borders.
//
// CSS cannot import these constants, so the matching CSS rules
// (.left-pane min-width, .queue-column min-width) mirror them by value with a
// comment pointing back here, and a CSS-text test keeps the two in sync.

import { BACKEND_IDS_IN_UI_ORDER, type BackendId } from './types'
import type { Platform } from './electron-api'

/** The fixed width of one backend column, in CSS px — also its content floor:
 *  the per-column width below which the model row + enqueue button stop being
 *  usable. Columns are a fixed width, not responsive (.queue-column width ===
 *  min-width === this), so this is both the rendered column width and the amount
 *  the window minimum reserves per visible backend. */
export const COLUMN_MIN_PX = 160

/** A real minimum for the left prompt/preview pane, in CSS px — wide enough to
 *  keep the prompt textarea, the preview, and their toolbars usable rather than
 *  the flex default that lets the pane shrink to nothing. */
export const LEFT_PANE_MIN_PX = 360

/** The 1px border between adjacent panes (.right-pane border-left, plus the
 *  border-right on each .queue-column except the last). */
export const PANE_BORDER_PX = 1

/** Stacked vertical region minimums for the left pane, in CSS px. The window
 *  minimum height is their sum: fixed chrome (the in-client pane toolbar that
 *  carries the app name + menu) is reserved first, then the prompt-input region
 *  and the preview region each keep a real minimum so neither is squeezed out. */
export const PANE_TOOLBAR_MIN_PX = 42
export const PROMPT_REGION_MIN_PX = 220
export const PREVIEW_REGION_MIN_PX = 280

/**
 * Backends shown as columns for a given platform, derived from the single UI
 * order list. Draw Things is macOS-only. This is the pure, platform-parameterized
 * form of the renderer's getVisibleBackends() — both must use this one filter so
 * the window minimum's column count can never disagree with what the UI renders.
 */
export function getVisibleBackendsForPlatform(platform: Platform): BackendId[] {
  return platform === 'darwin'
    ? BACKEND_IDS_IN_UI_ORDER
    : BACKEND_IDS_IN_UI_ORDER.filter((b) => b !== 'drawthings')
}

/** Number of visible backend columns for a platform (6 on darwin, 5 elsewhere). */
export function getVisibleBackendCount(platform: Platform): number {
  return getVisibleBackendsForPlatform(platform).length
}

/**
 * Minimum window width for a platform: the left pane's minimum, plus one column
 * minimum per visible backend, plus one inter-pane border per boundary
 * (left-pane↔right-pane and between every adjacent column). Strictly derived —
 * change any constant above or the backend list and this moves with it.
 */
export function computeWindowMinWidth(platform: Platform): number {
  const columns = getVisibleBackendCount(platform)
  // Borders: one between the left pane and the right column group, plus one
  // between each pair of adjacent columns (columns - 1). With >= 1 column that
  // is exactly `columns` borders.
  const borders = columns * PANE_BORDER_PX
  return LEFT_PANE_MIN_PX + columns * COLUMN_MIN_PX + borders
}

/**
 * Minimum window height: the sum of the left pane's stacked region minimums —
 * the fixed pane toolbar (chrome reserved first) plus the prompt and preview
 * regions. The right-pane columns are shorter than this, so the left pane is the
 * binding vertical dimension.
 */
export function computeWindowMinHeight(): number {
  return PANE_TOOLBAR_MIN_PX + PROMPT_REGION_MIN_PX + PREVIEW_REGION_MIN_PX
}
