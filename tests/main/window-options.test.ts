import { describe, expect, it } from 'vitest'
import { buildMainWindowOptions } from '../../src/main/window-options'
import {
  computeWindowDefaultWidth,
  computeWindowDefaultHeight,
  computeWindowMinWidth,
  computeWindowMinHeight,
  LEFT_PANE_MIN_PX,
  PREVIEW_REGION_MIN_PX,
} from '../../src/shared/layout-metrics'

// buildMainWindowOptions is the pure source the main process spreads into
// `new BrowserWindow({...})` and reads themeSource from. It carries no electron
// import, so it tests in the node env. These assertions pin the conformance
// points of the window-chrome-conventions: derived minimum size, the app's
// surface background, a framed (not frameless) window, and a forced dark title
// bar.

const PANE_COUNTS = [1, 2, 4, 5]

describe('buildMainWindowOptions', () => {
  it('uses the derived minimum width for the pane count it is given', () => {
    for (const panes of PANE_COUNTS) {
      expect(buildMainWindowOptions(panes).minWidth).toBe(computeWindowMinWidth(panes))
    }
  })

  it('uses the derived minimum height, which no pane count affects', () => {
    for (const panes of PANE_COUNTS) {
      expect(buildMainWindowOptions(panes).minHeight).toBe(computeWindowMinHeight())
    }
  })

  it('paints the app surface background color', () => {
    expect(buildMainWindowOptions(5).backgroundColor).toBe('#1a1a2e')
  })

  it('is a framed window, not frameless', () => {
    const opts = buildMainWindowOptions(5) as unknown as Record<string, unknown>
    // The main window keeps the native frame (only the secondary viewer/
    // notification windows are frameless). `frame:false` must never appear here.
    expect(opts['frame']).not.toBe(false)
  })

  it('forces the dark native title-bar theme', () => {
    expect(buildMainWindowOptions(5).themeSource).toBe('dark')
    expect(buildMainWindowOptions(1).themeSource).toBe('dark')
  })

  it('opens at a size that always clears the minimum (size not persisted)', () => {
    // The opening size must never be below the window's own minimum — otherwise
    // the OS would immediately snap it larger and the "opens at its default
    // size" guarantee would be a lie.
    for (const panes of PANE_COUNTS) {
      const opts = buildMainWindowOptions(panes)
      expect(opts.width).toBeGreaterThanOrEqual(computeWindowMinWidth(panes))
      expect(opts.height).toBeGreaterThanOrEqual(computeWindowMinHeight())
    }
  })

  // The opening width tracks the panes: a window opened wider than its panes
  // need gives the surplus to the left pane, which is what leaves the preview
  // far wider than it is tall. Fewer panes must therefore mean a narrower open.
  it('opens at the derived default width for its pane count', () => {
    for (const panes of PANE_COUNTS) {
      expect(buildMainWindowOptions(panes).width).toBe(computeWindowDefaultWidth(panes))
    }
  })

  it('opens narrower when fewer panes are shown', () => {
    expect(buildMainWindowOptions(1).width).toBeLessThan(buildMainWindowOptions(5).width)
  })

  // Columns display at COLUMN_DEFAULT_PX on a fresh install, so the opening width
  // must leave room for that, not for the narrower COLUMN_MIN_PX floor — otherwise
  // the columns open already squeezed below the width they are designed to show.
  it('opens wider than its own minimum, by the gap between default and floor', () => {
    for (const panes of PANE_COUNTS) {
      const opts = buildMainWindowOptions(panes)
      expect(opts.width).toBeGreaterThan(opts.minWidth)
    }
  })

  // Height is unaffected: nothing about it depends on how many columns exist.
  it('opens at the same height whatever the pane count', () => {
    const heights = new Set(PANE_COUNTS.map((panes) => buildMainWindowOptions(panes).height))
    expect(heights.size).toBe(1)
    expect(buildMainWindowOptions(1).height).toBe(computeWindowDefaultHeight())
  })

  // The opening width gives the left pane exactly its minimum, so a preview
  // region as tall as that minimum is a square preview. This is the assertion
  // that keeps the window from opening tall and narrow, or short and wide.
  it('opens tall enough for a square preview and clear of the height floor', () => {
    const opts = buildMainWindowOptions(1)
    expect(opts.height).toBeGreaterThanOrEqual(computeWindowMinHeight())
    expect(computeWindowDefaultHeight() - computeWindowMinHeight()).toBe(
      LEFT_PANE_MIN_PX - PREVIEW_REGION_MIN_PX
    )
  })
})
