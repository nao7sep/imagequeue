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

// The filter band's height is computed from the stylesheet's padding, control
// height, gap and line; each is read back from the stylesheets, with the rows
// counted from the band's markup (a search field, then the select rows).
describe('records filter band', () => {
  it('is as tall as the stylesheets draw it', async () => {
    const { readFileSync } = await import('node:fs')
    const tokens = readFileSync('src/renderer/src/styles.css', 'utf8')
    const css = readFileSync('src/renderer/src/records/RecordsWindow.css', 'utf8')
    const markup = readFileSync('src/renderer/src/records/RecordsWindow.tsx', 'utf8')
    const token = (name: string): number => Number(new RegExp(`--${name}:\\s*(\\d+)px;`).exec(tokens)![1])
    const band = /^\.records-filters \{([^}]*)\}/m.exec(css)![1]!
    const control = /^\.records-filters input,\n\.records-filters select \{([^}]*)\}/m.exec(css)![1]!
    const value = (body: string, property: string): number => {
      const raw = new RegExp(`(?:^|\\s)${property}:\\s*([^;]+);`).exec(body)![1]!.trim()
      const variable = /^var\(--([\w-]+)\)$/.exec(raw)
      return variable ? token(variable[1]!) : parseFloat(raw)
    }
    const rows = 1 + (markup.match(/className="records-filters-row"/g) ?? []).length
    const line = parseFloat(/^border-bottom:\s*(\d+)px/m.exec(band.trim().split('\n').map((l) => l.trim()).join('\n'))![1]!)
    expect(RECORDS_FILTERS_HEIGHT).toBe(2 * value(band, 'padding') + rows * value(control, 'height') + (rows - 1) * value(band, 'gap') + line)
  })
})

