import { describe, expect, it } from 'vitest'
import {
  defaultUiState,
  displayedColumnWidth,
  NOTIFICATION_VOLUME_DEFAULT,
  maxColumnWidthForContainer,
  leftPaneComfortWidth,
} from '../../src/shared/ui-state'
import {
  COLUMN_DEFAULT_PX,
  COLUMN_MIN_PX,
  LEFT_PANE_MIN_PX,
  PANE_BORDER_PX,
} from '../../src/shared/layout-metrics'

// The persisted intent (columnWidth) is turned into a rendered per-column width by
// displayedColumnWidth, the single pure function the splitter, the render, and
// these tests all share. Its contract: never below the content floor, never so
// wide the left pane loses its minimum, and an unset/invalid intent shows the floor.

describe('defaultUiState', () => {
  it('starts with no remembered column width (columns at their floor)', () => {
    expect(defaultUiState().columnWidth).toBeNull()
  })

  // The one home for this default. It used to be restated at four call sites as
  // `?? 0.7`, which is four chances to drift apart.
  it('starts at the default notification volume', () => {
    expect(defaultUiState().notificationVolume).toBe(NOTIFICATION_VOLUME_DEFAULT)
    expect(NOTIFICATION_VOLUME_DEFAULT).toBeGreaterThan(0)
    expect(NOTIFICATION_VOLUME_DEFAULT).toBeLessThanOrEqual(1)
  })
})

describe('maxColumnWidthForContainer', () => {
  it('is the space left after the left pane and borders, split across the columns', () => {
    // 2000 wide, 6 columns: (2000 - 360 - 6*1) / 6 = 272.33 -> floor 272.
    const expected = Math.floor((2000 - LEFT_PANE_MIN_PX - 6 * PANE_BORDER_PX) / 6)
    expect(maxColumnWidthForContainer(2000, 6)).toBe(expected)
  })

  it('never drops below the column floor, even on a cramped container', () => {
    expect(maxColumnWidthForContainer(600, 6)).toBe(COLUMN_MIN_PX)
  })

  it('is the floor exactly at the window minimum (columns at floor, left at its min)', () => {
    // The window minimum reserves left-min + count*floor + count borders.
    const count = 6
    const windowMin = LEFT_PANE_MIN_PX + count * COLUMN_MIN_PX + count * PANE_BORDER_PX
    expect(maxColumnWidthForContainer(windowMin, count)).toBe(COLUMN_MIN_PX)
  })
})

describe('displayedColumnWidth', () => {
  // The default is COLUMN_DEFAULT_PX, deliberately NOT the floor. They were once the
  // same value, which meant a fresh install opened every column at its minimum and
  // clipped the longest model names; these two assert they stay apart.
  it('opens at the default width when the intent is unset', () => {
    expect(displayedColumnWidth(null, 3000, 6)).toBe(COLUMN_DEFAULT_PX)
    expect(COLUMN_DEFAULT_PX).toBeGreaterThan(COLUMN_MIN_PX)
  })

  it('returns a roomy intent verbatim when the container can fit it', () => {
    expect(displayedColumnWidth(240, 3000, 6)).toBe(240)
  })

  it('clamps a too-wide intent down to what the container fits', () => {
    const max = maxColumnWidthForContainer(1400, 6)
    expect(displayedColumnWidth(500, 1400, 6)).toBe(max)
    expect(displayedColumnWidth(500, 1400, 6)).toBeLessThan(500)
  })

  it('floors an intent below the content minimum', () => {
    expect(displayedColumnWidth(80, 3000, 6)).toBe(COLUMN_MIN_PX)
  })

  it('preserves a wide intent through a narrow window (clamps display, not intent)', () => {
    // The SAME intent shows narrow on a small window and wide on a large one — the
    // intent itself is never rewritten, so widening the window restores it.
    const intent = 300
    expect(displayedColumnWidth(intent, 1200, 6)).toBe(maxColumnWidthForContainer(1200, 6))
    expect(displayedColumnWidth(intent, 3000, 6)).toBe(300)
  })

  it('falls back to the default on a non-finite intent', () => {
    expect(displayedColumnWidth(Number.NaN, 3000, 6)).toBe(COLUMN_DEFAULT_PX)
  })

  it('rounds a fractional intent', () => {
    expect(displayedColumnWidth(200.6, 3000, 6)).toBe(201)
  })
})

describe('wide-window surplus flows to the columns', () => {
  // The left pane is flex, so before this rule it absorbed every surplus pixel
  // and the preview grew sideways without limit. Once the left pane would pass
  // its comfort width — the width at which the preview is square — the columns
  // take the surplus instead.
  it('boosts columns past the intent once the left pane would exceed comfort', () => {
    // 900px tall → comfort = 900 - 42 - 220 = 638. Five columns at the 220
    // intent leave 1900 - 638 - 5 = 1257 for columns → 251 each.
    const w = displayedColumnWidth(220, 1900, 5, 900)
    expect(w).toBe(251)
  })

  it('never narrows below the user intent', () => {
    // A wide intent on a window whose surplus share is smaller: intent wins.
    // 2500px: surplus share = (2500 - 638 - 5) / 5 = 371 < 400, cap = 427.
    const w = displayedColumnWidth(400, 2500, 5, 900)
    expect(w).toBe(400)
  })

  it('still caps at what leaves the left pane its minimum', () => {
    // A short, wide window: comfort floors at LEFT_PANE_MIN, and the cap
    // (which reserves LEFT_PANE_MIN) binds before the boost can exceed it.
    const cap = maxColumnWidthForContainer(1900, 5)
    expect(displayedColumnWidth(220, 1900, 5, 300)).toBe(cap)
  })

  it('does not boost while the container height is unknown', () => {
    expect(displayedColumnWidth(220, 1900, 5, null)).toBe(220)
    expect(displayedColumnWidth(220, 1900, 5)).toBe(220)
  })

  it('comfort width floors at the left-pane minimum on a short window', () => {
    expect(leftPaneComfortWidth(300)).toBe(LEFT_PANE_MIN_PX)
    expect(leftPaneComfortWidth(900)).toBe(900 - 42 - 220)
  })

  it('a narrow window is untouched: no surplus, no boost, cap as before', () => {
    // At the five-pane window minimum there is nothing to distribute.
    expect(displayedColumnWidth(220, 1315, 5, 622)).toBe(displayedColumnWidth(220, 1315, 5))
  })
})
