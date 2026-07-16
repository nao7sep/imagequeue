import { describe, expect, it } from 'vitest'
import {
  defaultUiState,
  displayedColumnWidth,
  maxColumnWidthForContainer,
} from '../../src/shared/ui-state'
import { COLUMN_MIN_PX, LEFT_PANE_MIN_PX, PANE_BORDER_PX } from '../../src/shared/layout-metrics'

// The persisted intent (columnWidth) is turned into a rendered per-column width by
// displayedColumnWidth, the single pure function the splitter, the render, and
// these tests all share. Its contract: never below the content floor, never so
// wide the left pane loses its minimum, and an unset/invalid intent shows the floor.

describe('defaultUiState', () => {
  it('starts with no remembered column width (columns at their floor)', () => {
    expect(defaultUiState()).toEqual({ columnWidth: null })
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
  it('shows the floor when the intent is unset (default)', () => {
    expect(displayedColumnWidth(null, 3000, 6)).toBe(COLUMN_MIN_PX)
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

  it('falls back to the floor on a non-finite intent', () => {
    expect(displayedColumnWidth(Number.NaN, 3000, 6)).toBe(COLUMN_MIN_PX)
  })

  it('rounds a fractional intent', () => {
    expect(displayedColumnWidth(200.6, 3000, 6)).toBe(201)
  })
})
