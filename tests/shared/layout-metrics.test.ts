import { describe, expect, it } from 'vitest'
import {
  COLUMN_DEFAULT_PX,
  COLUMN_MAX_PX,
  COLUMN_MIN_PX,
  LEFT_PANE_MIN_PX,
  PANE_BORDER_PX,
  PANE_TOOLBAR_MIN_PX,
  PROMPT_REGION_MIN_PX,
  PREVIEW_REGION_MIN_PX,
  getVisibleBackendsForPlatform,
  computeWindowMinWidth,
  computeWindowMinHeight,
} from '../../src/shared/layout-metrics'
import { BACKEND_IDS_IN_UI_ORDER } from '../../src/shared/types'

describe('backend pane width bounds', () => {
  it('keeps the default strictly between the usable minimum and maximum', () => {
    expect(COLUMN_MIN_PX).toBeLessThan(COLUMN_DEFAULT_PX)
    expect(COLUMN_DEFAULT_PX).toBeLessThan(COLUMN_MAX_PX)
  })
})

// Window geometry derives from pane minimums and the actual visible pane count.
// Platform capability is only one input to visibility.

describe('getVisibleBackendsForPlatform', () => {
  it('supports every backend, including Draw Things, on darwin', () => {
    expect(getVisibleBackendsForPlatform('darwin')).toEqual(BACKEND_IDS_IN_UI_ORDER)
    expect(getVisibleBackendsForPlatform('darwin')).toContain('drawthings')
  })

  it('excludes Draw Things on non-darwin platforms', () => {
    expect(getVisibleBackendsForPlatform('win32')).toEqual(
      BACKEND_IDS_IN_UI_ORDER.filter((b) => b !== 'drawthings')
    )
    expect(getVisibleBackendsForPlatform('linux')).not.toContain('drawthings')
  })
})

describe('computeWindowMinWidth', () => {

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
  })

})

describe('computeWindowMinHeight', () => {

  it('reserves the fixed pane-toolbar chrome on top of the content regions', () => {
    expect(computeWindowMinHeight()).toBeGreaterThan(PROMPT_REGION_MIN_PX + PREVIEW_REGION_MIN_PX)
  })
})
