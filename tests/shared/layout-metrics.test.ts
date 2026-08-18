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

  it('counts 5 columns on darwin and 4 elsewhere', () => {
    expect(getVisibleBackendCount('darwin')).toBe(5)
    expect(getVisibleBackendCount('win32')).toBe(4)
    expect(getVisibleBackendCount('linux')).toBe(4)
    // Derived from the list, not a literal: the darwin count is the full list,
    // and the off-mac count is exactly one fewer (Draw Things).
    expect(getVisibleBackendCount('darwin')).toBe(BACKEND_IDS_IN_UI_ORDER.length)
    expect(getVisibleBackendCount('win32')).toBe(BACKEND_IDS_IN_UI_ORDER.length - 1)
  })
})

describe('computeWindowMinWidth', () => {
  it('equals LEFT_PANE_MIN + one COLUMN_MIN and border per pane', () => {
    for (const panes of [1, 2, 4, 5]) {
      expect(computeWindowMinWidth(panes)).toBe(
        LEFT_PANE_MIN_PX + panes * COLUMN_MIN_PX + panes * PANE_BORDER_PX
      )
    }
  })

  it('reserves at least the sum of the pane minimums', () => {
    for (const panes of [1, 2, 4, 5]) {
      expect(computeWindowMinWidth(panes)).toBeGreaterThanOrEqual(
        LEFT_PANE_MIN_PX + panes * COLUMN_MIN_PX
      )
    }
  })

  it('grows by exactly one column plus its border for each added pane', () => {
    expect(computeWindowMinWidth(5) - computeWindowMinWidth(4)).toBe(
      COLUMN_MIN_PX + PANE_BORDER_PX
    )
    expect(computeWindowMinWidth(2) - computeWindowMinWidth(1)).toBe(
      COLUMN_MIN_PX + PANE_BORDER_PX
    )
  })

  // The point of taking a count: a user with one provider is not held to a
  // window sized for a full set of columns that are not being drawn.
  it('lets a single-pane layout open far narrower than a full one', () => {
    expect(computeWindowMinWidth(1)).toBeLessThan(computeWindowMinWidth(5))
    expect(computeWindowMinWidth(1)).toBe(LEFT_PANE_MIN_PX + COLUMN_MIN_PX + PANE_BORDER_PX)
  })

  it('still agrees with the platform column count when every backend is shown', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const columns = getVisibleBackendCount(platform)
      expect(computeWindowMinWidth(columns)).toBe(
        LEFT_PANE_MIN_PX + columns * COLUMN_MIN_PX + columns * PANE_BORDER_PX
      )
    }
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
