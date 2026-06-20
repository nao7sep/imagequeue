// Pure builder for the main BrowserWindow's chrome and sizing options.
//
// Kept free of any `electron` import so it can be unit-tested in the node test
// env, and so the content-based window minimum is derived in one place from the
// shared layout metrics rather than hand-typed in createWindow. The main process
// (src/main/index.ts) spreads the result into `new BrowserWindow({ ... })`,
// adding only the environment-bound bits (the preload path) and applying
// `themeSource` to nativeTheme.
//
// Per the window-chrome-conventions: the app ships a single dark theme, so the
// title bar is forced dark (themeSource), the window is framed (not frameless —
// only the secondary viewer/notification windows are frameless), and the minimum
// size is the sum of the panes' minimums plus chrome, derived from
// shared/layout-metrics — never a magic literal.

import { computeWindowMinWidth, computeWindowMinHeight } from '../shared/layout-metrics'
import type { Platform } from '../shared/electron-api'

export interface MainWindowOptions {
  width: number
  height: number
  minWidth: number
  minHeight: number
  backgroundColor: string
  /** Native-theme source applied to nativeTheme so the title bar matches the
   *  app's dark theme rather than following the OS appearance. */
  themeSource: 'dark'
}

/** Designed opening size; the window opens at this size on every launch (size is
 *  not persisted — see window-chrome-conventions). This is the intent for a
 *  roomy default, but it is clamped up to clear the platform's derived minimum
 *  so the window never opens below its own minimum (where the OS would
 *  immediately snap it larger). */
const DESIGNED_WIDTH = 1280
const DESIGNED_HEIGHT = 720

/** Comfortable headroom added over the bare minimum when the designed default
 *  doesn't already clear it — so the default doesn't sit exactly on the floor
 *  with every pane at its smallest. */
const DEFAULT_WIDTH_HEADROOM = 80
const DEFAULT_HEIGHT_HEADROOM = 80

/** The app's primary surface color (matches --bg-primary in styles.css), painted
 *  behind the renderer so there is no white flash before first paint. */
const BACKGROUND_COLOR = '#1a1a2e'

/**
 * Build the chrome/sizing options for the main window on a given platform. The
 * minWidth/minHeight are derived from the shared pane minimums (and the
 * platform-dependent visible-column count), so they can never silently disagree
 * with the layout the renderer paints. The opening size is the designed default
 * clamped up to the derived minimum (plus headroom) so it is always valid — on
 * the 6-column macOS layout the content minimum exceeds the bare 720p-style
 * default, so the default grows to match rather than open under its minimum.
 */
export function buildMainWindowOptions(platform: Platform): MainWindowOptions {
  const minWidth = computeWindowMinWidth(platform)
  const minHeight = computeWindowMinHeight()
  return {
    width: Math.max(DESIGNED_WIDTH, minWidth + DEFAULT_WIDTH_HEADROOM),
    height: Math.max(DESIGNED_HEIGHT, minHeight + DEFAULT_HEIGHT_HEADROOM),
    minWidth,
    minHeight,
    backgroundColor: BACKGROUND_COLOR,
    themeSource: 'dark'
  }
}
