import { describe, expect, it } from 'vitest'
import { cursorAfter, mergeNewestPage, prettyJson, recordKey } from '../../../../src/renderer/src/records/record-format'
import type { RecordSummary } from '../../../../src/shared/records'

const row = (id: number, time: string, title = `row ${id}`): RecordSummary => ({
  kind: 'log', id, time, level: 'info', title, text: null,
})

const a = row(1, '2026-10-02T08:00:01.000Z')
const b = row(2, '2026-10-02T08:00:02.000Z')
const c = row(3, '2026-10-02T08:00:03.000Z')
const d = row(4, '2026-10-02T08:00:04.000Z')
const keys = (records: RecordSummary[]) => records.map(recordKey)

describe('mergeNewestPage', () => {
  it('puts new records ahead of the rows shown and keeps the pages already read', () => {
    const merged = mergeNewestPage([c, b, a], true, { records: [d, c], more: true })
    expect(keys(merged.records)).toEqual(keys([d, c, b, a]))
    expect(merged.more).toBe(true)
  })

  it("takes the page's word on whether more follow when it reaches past every row shown", () => {
    expect(mergeNewestPage([b], true, { records: [c, b, a], more: false }).more).toBe(false)
  })

  it('loses nothing to an older page that arrives after a newer one', () => {
    const merged = mergeNewestPage([d, c, b, a], true, { records: [c, b], more: true })
    expect(keys(merged.records)).toEqual(keys([d, c, b, a]))
    expect(merged.more).toBe(true)
  })

  it("takes the page's copy of a row it shares with the list", () => {
    const fresh = { ...c, title: 'fresh' }
    expect(mergeNewestPage([c], false, { records: [fresh], more: false }).records[0]!.title).toBe('fresh')
  })

  it('orders a log line and an AI call of the same time as the database does', () => {
    const call: RecordSummary = { ...c, kind: 'ai-call', id: 9 }
    expect(keys(mergeNewestPage([call], false, { records: [c], more: false }).records)).toEqual(['log:3', 'ai-call:9'])
  })
})

describe('record formatting', () => {
  it('indents stored JSON and shows other text as it is', () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(prettyJson('not json')).toBe('not json')
  })

  it('continues after the last row shown', () => {
    expect(cursorAfter([d, c])).toEqual({ time: c.time, kind: 'log', id: 3 })
    expect(cursorAfter([])).toBeNull()
  })
})
