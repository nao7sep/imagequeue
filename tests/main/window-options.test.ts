import { describe, expect, it } from 'vitest'
import { buildMainWindowOptions } from '../../src/main/window-options'
import {
  computeWindowMinWidth,
  computeWindowMinHeight,
} from '../../src/shared/layout-metrics'

// buildMainWindowOptions is the pure source the main process spreads into
// `new BrowserWindow({...})` and reads themeSource from. It carries no electron
// import, so it tests in the node env. These assertions pin the conformance
// points of the window-chrome-conventions: derived minimum size, the app's
// surface background, a framed (not frameless) window, and a forced dark title
// bar.

describe('buildMainWindowOptions', () => {
  it('uses the derived minimum width per platform', () => {
    expect(buildMainWindowOptions('darwin').minWidth).toBe(computeWindowMinWidth('darwin'))
    expect(buildMainWindowOptions('win32').minWidth).toBe(computeWindowMinWidth('win32'))
    expect(buildMainWindowOptions('linux').minWidth).toBe(computeWindowMinWidth('linux'))
  })

  it('uses the derived minimum height', () => {
    expect(buildMainWindowOptions('darwin').minHeight).toBe(computeWindowMinHeight())
    expect(buildMainWindowOptions('win32').minHeight).toBe(computeWindowMinHeight())
  })

  it('paints the app surface background color', () => {
    expect(buildMainWindowOptions('darwin').backgroundColor).toBe('#1a1a2e')
  })

  it('is a framed window, not frameless', () => {
    const opts = buildMainWindowOptions('darwin') as unknown as Record<string, unknown>
    // The main window keeps the native frame (only the secondary viewer/
    // notification windows are frameless). `frame:false` must never appear here.
    expect(opts['frame']).not.toBe(false)
  })

  it('forces the dark native title-bar theme', () => {
    expect(buildMainWindowOptions('darwin').themeSource).toBe('dark')
    expect(buildMainWindowOptions('win32').themeSource).toBe('dark')
  })

  it('opens at a default size that always clears the minimum (size not persisted)', () => {
    // The opening size must never be below the window's own minimum — otherwise
    // the OS would immediately snap it larger and the "opens at its default
    // size" guarantee would be a lie. On the 6-column macOS layout the content
    // minimum exceeds a bare 720p-style default, so the default must grow with
    // it rather than stay pinned at a literal.
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const opts = buildMainWindowOptions(platform)
      expect(opts.width).toBeGreaterThanOrEqual(computeWindowMinWidth(platform))
      expect(opts.height).toBeGreaterThanOrEqual(computeWindowMinHeight())
    }
  })
})
