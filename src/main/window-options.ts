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

import {
  computeWindowDefaultWidth,
  computeWindowDefaultHeight,
  computeWindowMinWidth,
  computeWindowMinHeight,
} from '../shared/layout-metrics'

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

/** The app's primary surface color (matches --bg-primary in styles.css), painted
 *  behind the renderer so there is no white flash before first paint. */
const BACKGROUND_COLOR = '#1a1a2e'

/**
 * Build the chrome/sizing options for the main window, given how many panes the
 * right-hand group will show (getVisiblePanes). Both the minimum and the opening
 * width come from that count via the shared pane minimums, so neither can
 * silently disagree with the layout the renderer paints, and a user with one
 * provider is not forced into a window sized for five.
 */
export function buildMainWindowOptions(paneCount: number): MainWindowOptions {
  const minWidth = computeWindowMinWidth(paneCount)
  const minHeight = computeWindowMinHeight()
  return {
    width: computeWindowDefaultWidth(paneCount),
    height: computeWindowDefaultHeight(),
    minWidth,
    minHeight,
    backgroundColor: BACKGROUND_COLOR,
    themeSource: 'dark'
  }
}
