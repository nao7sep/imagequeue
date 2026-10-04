import { describe, expect, it } from 'vitest'
import { cursorAfter, jsonBlockText, mergeNewestPage, outputBlockText, recordKey } from '../../../../src/renderer/src/records/record-format'
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
    expect(jsonBlockText('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(jsonBlockText('[0]')).toBe('[\n  0\n]')
    expect(jsonBlockText('false')).toBe('false')
    expect(jsonBlockText('"text"')).toBe('"text"')
    expect(jsonBlockText('not json')).toBe('not json')
  })

  it('leaves out a block with nothing in it', () => {
    for (const empty of [null, '', '  \n', '{}', ' { } ', 'null', '[]', '""', '"  "']) {
      expect(jsonBlockText(empty)).toBeNull()
    }
  })

  it("shows a CLI job's output as a terminal would have left it", () => {
    expect(outputBlockText('Downloading 10%\rDownloading 55%\rDownloading 100%\r\nDone\n')).toBe('Downloading 100%\nDone')
    expect(outputBlockText('\x1B[32mImported\x1B[0m model\r\n')).toBe('Imported model')
    expect(outputBlockText('50%\r\n  indented\n\nlast')).toBe('50%\n  indented\n\nlast')
  })

  it("leaves out a CLI job's output that is only whitespace", () => {
    for (const empty of ['', ' \n', '\r\n\r\n', '\x1B[0m\n']) expect(outputBlockText(empty)).toBeNull()
  })

  it('continues after the last row shown', () => {
    expect(cursorAfter([d, c])).toEqual({ time: c.time, kind: 'log', id: 3 })
    expect(cursorAfter([])).toBeNull()
  })
})
