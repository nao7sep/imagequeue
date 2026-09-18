// Pure builder for the main BrowserWindow's chrome and sizing options.
//
// Kept free of any `electron` import so it can be unit-tested in the node test
// env, and so the content-based window minimum is derived in one place from the
// shared layout metrics rather than hand-typed in createWindow. The main process
// (src/main/index.ts) spreads the result into `new BrowserWindow({ ... })`,
// adding only the environment-bound bits (the preload path and the background of
// the resolved theme, see mainWindowBackground).
//
// The window is framed (not frameless — only the secondary viewer/notification
// windows are frameless), and the minimum size is the sum of the panes' minimums
// plus chrome, derived from shared/layout-metrics — never a magic literal.

import {
  computeWindowDefaultWidth,
  computeWindowDefaultHeight,
  computeWindowMinWidth,
  computeWindowMinHeight,
} from '../shared/layout-metrics'

export interface MainWindowOptions {
  name: string
  width: number
  height: number
  minWidth: number
  minHeight: number
  windowStatePersistence: {
    bounds: true
    displayMode: boolean
  }
  show: false
}

/** The app's primary surface color in each theme (matches --bg-primary in
 *  styles.css), painted behind the renderer so there is no flash of another
 *  color before first paint. */
export function mainWindowBackground(dark: boolean): string {
  return dark ? '#1a1a2e' : '#f3f5fb'
}

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
    name: 'main-window',
    width: computeWindowDefaultWidth(paneCount),
    height: computeWindowDefaultHeight(),
    minWidth,
    minHeight,
    windowStatePersistence: {
      bounds: true,
      displayMode: process.platform === 'win32'
    },
    show: false,
  }
}
