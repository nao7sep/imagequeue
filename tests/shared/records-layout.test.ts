import { describe, expect, it } from 'vitest'
import {
  RECORDS_DETAIL_MIN_WIDTH,
  RECORDS_FILTERS_HEIGHT,
  RECORDS_LIST_MIN_HEIGHT,
  RECORDS_LIST_WIDTH,
  RECORDS_SPLITTER_PX,
  RECORDS_WINDOW_MIN_HEIGHT,
  RECORDS_WINDOW_MIN_WIDTH,
  clampRecordsListWidth,
  displayedRecordsListWidth,
} from '../../src/shared/records-layout'

describe('records window layout', () => {
  it('opens the list at about 380px, between about 320 and 640', () => {
    expect(RECORDS_LIST_WIDTH).toEqual({ min: 320, default: 380, max: 640 })
  })

  it('derives the window minimum from the panes', () => {
    expect(RECORDS_WINDOW_MIN_WIDTH).toBe(RECORDS_LIST_WIDTH.min + RECORDS_SPLITTER_PX + RECORDS_DETAIL_MIN_WIDTH)
    expect(RECORDS_WINDOW_MIN_HEIGHT).toBe(RECORDS_FILTERS_HEIGHT + RECORDS_LIST_MIN_HEIGHT)
  })

  it('heals a stored width to the bounds, and anything else to the default', () => {
    expect(clampRecordsListWidth(450.6)).toBe(451)
    expect(clampRecordsListWidth(10)).toBe(RECORDS_LIST_WIDTH.min)
    expect(clampRecordsListWidth(9999)).toBe(RECORDS_LIST_WIDTH.max)
    expect(clampRecordsListWidth('wide')).toBe(RECORDS_LIST_WIDTH.default)
    expect(clampRecordsListWidth(Number.NaN)).toBe(RECORDS_LIST_WIDTH.default)
    expect(clampRecordsListWidth(undefined)).toBe(RECORDS_LIST_WIDTH.default)
  })

  it('narrows the shown list so the detail pane keeps its minimum, and returns to the intent when room returns', () => {
    expect(displayedRecordsListWidth(600, 2000)).toBe(600)
    expect(displayedRecordsListWidth(600, RECORDS_WINDOW_MIN_WIDTH + 50)).toBe(RECORDS_LIST_WIDTH.min + 50)
    expect(displayedRecordsListWidth(600, RECORDS_WINDOW_MIN_WIDTH)).toBe(RECORDS_LIST_WIDTH.min)
    expect(displayedRecordsListWidth(600, 100)).toBe(RECORDS_LIST_WIDTH.min)
  })

  it('mirrors the stylesheet', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync('src/renderer/src/records/RecordsWindow.css', 'utf8')
    expect(css).toContain(`grid-template-columns: var(--records-list-width) ${RECORDS_SPLITTER_PX}px minmax(${RECORDS_DETAIL_MIN_WIDTH}px, 1fr);`)
  })
})
