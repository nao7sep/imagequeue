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

import { BACKEND_IDS_IN_UI_ORDER, type BackendId, type CloudBackendId } from './types'
import type { Platform } from './electron-api'

/** The narrowest a backend column may ever display, in CSS px — the floor, NOT the
 *  default (that is COLUMN_DEFAULT_PX below). Below this the model row and enqueue
 *  button stop being usable. It stays tight because the window minimum reserves one
 *  of these per visible backend, so raising it raises the smallest window the app can
 *  open in: 190 puts the five-column minimum at 1315, which still fits a 1366-wide
 *  laptop, where 200 would push it to 1365 and leave a single pixel of slack. */
export const COLUMN_MIN_PX = 190

/** The width a column displays when the user has never dragged the splitter.
 *
 *  Measured, not guessed: rendered in Electron's own engine, the widest setting row
 *  a column must hold is `background: transparent` at 193px and the longest model
 *  name ("Grok Imagine Quality") at 211px, so anything under ~215 truncates real
 *  content on a fresh install. This used to BE COLUMN_MIN_PX, which meant every
 *  column opened at its absolute floor and clipped a third of the longest rows.
 *
 *  The floor and the default are separate on purpose: a cramped window can still
 *  squeeze columns down to COLUMN_MIN_PX, but nobody starts there. */
export const COLUMN_DEFAULT_PX = 220

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

/** Number of visible backend columns for a platform — one fewer off macOS,
 *  where Draw Things does not run. */
export function getVisibleBackendCount(platform: Platform): number {
  return getVisibleBackendsForPlatform(platform).length
}

/** A pane in the right-hand group. Every backend column, plus the welcome pane,
 *  which is a pane and NOT a backend: it holds no tasks, so column shortcuts and
 *  selection navigation iterate the backends, never this list. */
export type PaneId = BackendId | 'welcome'

export const WELCOME_PANE = 'welcome' as const

/**
 * The panes the right-hand group shows, in order. A cloud backend appears only
 * once it has a key — an unusable column is noise, and its absence is what the
 * window minimum shrinks to fit. Draw Things needs no key, so on macOS its column
 * is always there, installed or not; the column carries its own route to the
 * installer.
 *
 * The welcome pane stands in when that leaves the group empty, which keeps a
 * fresh install from being a preview pane beside a strip of nothing. Because
 * macOS always has the Draw Things column, an empty group is only reachable off
 * macOS — so the welcome pane is in practice a Windows one, and says nothing
 * about a backend that platform cannot run.
 */
export function getVisiblePanes(
  platform: Platform,
  keyedCloudBackends: readonly CloudBackendId[]
): PaneId[] {
  const columns = getVisibleBackendsForPlatform(platform).filter(
    (id) => id === 'drawthings' || keyedCloudBackends.includes(id as CloudBackendId)
  )
  return columns.length > 0 ? columns : [WELCOME_PANE]
}

/** Panes that are backends — the list column shortcuts and selection navigation
 *  walk. Derived from getVisiblePanes so the two can never drift apart. */
export function getVisibleBackendColumns(panes: readonly PaneId[]): BackendId[] {
  return panes.filter((id): id is BackendId => id !== WELCOME_PANE)
}

/**
 * Minimum window width for a given number of right-hand panes: the left pane's
 * minimum, plus one column minimum per pane, plus one inter-pane border per
 * boundary (left-pane↔right-pane and between every adjacent pane). Strictly
 * derived — change any constant above and this moves with it.
 *
 * It takes the pane COUNT, not a platform, because the panes shown depend on
 * which providers are configured as well as the platform (getVisiblePanes). A
 * minimum that reserved width for panes nobody is drawing would forbid window sizes
 * the layout can hold perfectly well.
 */
export function computeWindowMinWidth(paneCount: number): number {
  // Borders: one between the left pane and the right pane group, plus one
  // between each pair of adjacent panes (paneCount - 1). With >= 1 pane that is
  // exactly `paneCount` borders.
  const borders = paneCount * PANE_BORDER_PX
  return LEFT_PANE_MIN_PX + paneCount * COLUMN_MIN_PX + borders
}

/**
 * The width the window opens at for a given pane count: the left pane at its
 * minimum, plus one column at its DEFAULT width per pane, plus the borders. It
 * uses COLUMN_DEFAULT_PX, not COLUMN_MIN_PX, because that is the width a column
 * actually displays at on a fresh install — opening any wider hands the surplus
 * to the left pane, which is what stretches the preview sideways.
 */
export function computeWindowDefaultWidth(paneCount: number): number {
  return LEFT_PANE_MIN_PX + paneCount * COLUMN_DEFAULT_PX + paneCount * PANE_BORDER_PX
}

/**
 * The height the window opens at. The opening WIDTH always leaves the left pane
 * exactly its minimum (the surplus goes to the columns), so giving the preview
 * region that same measure as its height opens the preview square. It is
 * independent of the pane count, because nothing about the vertical stack is.
 *
 * This sits above computeWindowMinHeight, so the window never opens on its floor.
 */
export function computeWindowDefaultHeight(): number {
  return PANE_TOOLBAR_MIN_PX + PROMPT_REGION_MIN_PX + LEFT_PANE_MIN_PX
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
