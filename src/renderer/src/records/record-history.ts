import type { RecordCursor, RecordsPage, RecordSummary } from '../../../shared/records'
import { recordKey } from './record-format'

/** Loaded history in display order. Stable ordinals avoid reindexing history
 * on prepend. */
export class RecordHistory {
  private first = 0
  private end = 0
  private readonly records = new Map<number, RecordSummary>()
  private readonly positions = new Map<string, number>()
  more = false

  get count(): number { return this.end - this.first }
  at(index: number): RecordSummary { return this.records.get(this.first + index)! }
  idAt(index: number): string { return recordKey(this.at(index)) }
  indexOf(key: string): number {
    const position = this.positions.get(key)
    return position === undefined ? -1 : position - this.first
  }
  get after(): RecordCursor | null {
    if (!this.count) return null
    const { time, kind, id } = this.at(this.count - 1)
    return { time, kind, id }
  }

  private insert(position: number, record: RecordSummary): void {
    this.records.set(position, record)
    this.positions.set(recordKey(record), position)
  }
  append(page: RecordsPage): void {
    for (const record of page.records) {
      if (this.indexOf(recordKey(record)) < 0) this.insert(this.end++, record)
    }
    this.more = page.more
  }
  prepend(records: readonly RecordSummary[]): void {
    for (let index = records.length - 1; index >= 0; index--) {
      const record = records[index]!
      if (this.indexOf(recordKey(record)) < 0) this.insert(--this.first, record)
    }
  }
}

/** A burst can span many pages. Do not join disconnected ranges: read through
 * the first known identity. A failed/interrupted bridge leaves the previously
 * admitted history intact. */
export async function readHistoryPrefix(
  history: RecordHistory,
  read: (after: RecordCursor | null) => Promise<RecordsPage>,
  current: () => boolean,
): Promise<{ records: RecordSummary[]; first: RecordsPage; incomplete: boolean } | null> {
  const first = await read(null)
  if (!current()) return null
  const records: RecordSummary[] = []
  let page = first
  let incomplete = first.searchIncomplete === true
  while (true) {
    for (const record of page.records) {
      if (history.indexOf(recordKey(record)) >= 0) return { records, first, incomplete }
      records.push(record)
    }
    if (!history.count || !page.more || !page.records.length) return { records, first, incomplete }
    const last = page.records.at(-1)!
    page = await read({ time: last.time, kind: last.kind, id: last.id })
    if (!current()) return null
    incomplete ||= page.searchIncomplete === true
  }
}
