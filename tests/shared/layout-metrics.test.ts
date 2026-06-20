import { describe, expect, it } from 'vitest'
import {
  COLUMN_MIN_PX,
  LEFT_PANE_MIN_PX,
  PANE_BORDER_PX,
  PANE_TOOLBAR_MIN_PX,
  PROMPT_REGION_MIN_PX,
  PREVIEW_REGION_MIN_PX,
  getVisibleBackendsForPlatform,
  getVisibleBackendCount,
  computeWindowMinWidth,
  computeWindowMinHeight,
} from '../../src/shared/layout-metrics'
import { BACKEND_IDS_IN_UI_ORDER } from '../../src/shared/types'

// The window minimum must be DERIVED from the pane minimums and the
// platform-dependent visible-column count, never a hand-typed constant. These
// tests pin that derivation: the value equals the explicit sum, moves when the
// constants move, and the column count it uses agrees with the same filter the
// UI renders from.

describe('getVisibleBackendsForPlatform', () => {
  it('shows every backend, including Draw Things, on darwin', () => {
    expect(getVisibleBackendsForPlatform('darwin')).toEqual(BACKEND_IDS_IN_UI_ORDER)
    expect(getVisibleBackendsForPlatform('darwin')).toContain('drawthings')
  })

  it('hides Draw Things on non-darwin platforms', () => {
    expect(getVisibleBackendsForPlatform('win32')).toEqual(
      BACKEND_IDS_IN_UI_ORDER.filter((b) => b !== 'drawthings')
    )
    expect(getVisibleBackendsForPlatform('linux')).not.toContain('drawthings')
  })

  it('counts 6 columns on darwin and 5 elsewhere', () => {
    expect(getVisibleBackendCount('darwin')).toBe(6)
    expect(getVisibleBackendCount('win32')).toBe(5)
    expect(getVisibleBackendCount('linux')).toBe(5)
    // Derived from the list, not a literal: the darwin count is the full list,
    // and the off-mac count is exactly one fewer (Draw Things).
    expect(getVisibleBackendCount('darwin')).toBe(BACKEND_IDS_IN_UI_ORDER.length)
    expect(getVisibleBackendCount('win32')).toBe(BACKEND_IDS_IN_UI_ORDER.length - 1)
  })
})

describe('computeWindowMinWidth', () => {
  it('equals LEFT_PANE_MIN + 6*COLUMN_MIN + borders on darwin', () => {
    const expected = LEFT_PANE_MIN_PX + 6 * COLUMN_MIN_PX + 6 * PANE_BORDER_PX
    expect(computeWindowMinWidth('darwin')).toBe(expected)
  })

  it('equals the 5-column sum on win32 and linux', () => {
    const expected = LEFT_PANE_MIN_PX + 5 * COLUMN_MIN_PX + 5 * PANE_BORDER_PX
    expect(computeWindowMinWidth('win32')).toBe(expected)
    expect(computeWindowMinWidth('linux')).toBe(expected)
  })

  it('is derived from the live constants and column count, not a literal', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const columns = getVisibleBackendCount(platform)
      expect(computeWindowMinWidth(platform)).toBe(
        LEFT_PANE_MIN_PX + columns * COLUMN_MIN_PX + columns * PANE_BORDER_PX
      )
    }
  })

  it('reserves at least the sum of the visible panes minimums', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const columns = getVisibleBackendCount(platform)
      const sumOfPaneMins = LEFT_PANE_MIN_PX + columns * COLUMN_MIN_PX
      expect(computeWindowMinWidth(platform)).toBeGreaterThanOrEqual(sumOfPaneMins)
    }
  })

  it('is wider on darwin than off-mac by exactly one column plus its border', () => {
    expect(computeWindowMinWidth('darwin') - computeWindowMinWidth('win32')).toBe(
      COLUMN_MIN_PX + PANE_BORDER_PX
    )
  })
})

describe('computeWindowMinHeight', () => {
  it('equals the sum of the stacked region minimums', () => {
    expect(computeWindowMinHeight()).toBe(
      PANE_TOOLBAR_MIN_PX + PROMPT_REGION_MIN_PX + PREVIEW_REGION_MIN_PX
    )
  })

  it('reserves the fixed pane-toolbar chrome on top of the content regions', () => {
    expect(computeWindowMinHeight()).toBeGreaterThan(PROMPT_REGION_MIN_PX + PREVIEW_REGION_MIN_PX)
  })
})
