import type { RecordCursor, RecordsPage, RecordSummary } from '../../../shared/records'
import { recordKey } from './record-format'

/** Visited history keeps only identity/order metadata. Full display payloads
 * belong to the viewport; stable ordinals avoid reindexing history on prepend. */
export class RecordHistory {
  private first = 0
  private end = 0
  private readonly cursors = new Map<number, RecordCursor>()
  private readonly positions = new Map<string, number>()
  readonly summaries = new Map<string, RecordSummary>()
  more = false

  get count(): number { return this.end - this.first }
  at(index: number): RecordCursor { return this.cursors.get(this.first + index)! }
  idAt(index: number): string { return recordKey(this.at(index)) }
  indexOf(key: string): number {
    const position = this.positions.get(key)
    return position === undefined ? -1 : position - this.first
  }
  get after(): RecordCursor | null { return this.count ? this.at(this.count - 1) : null }

  private insert(position: number, record: RecordCursor): void {
    const cursor = { time: record.time, kind: record.kind, id: record.id }
    this.cursors.set(position, cursor)
    this.positions.set(recordKey(cursor), position)
  }
  append(page: RecordsPage): void {
    for (const record of page.records) {
      if (this.indexOf(recordKey(record)) < 0) this.insert(this.end++, record)
      this.summaries.set(recordKey(record), record)
    }
    this.more = page.more
  }
  prepend(cursors: readonly RecordCursor[], visible: readonly RecordSummary[]): void {
    for (let index = cursors.length - 1; index >= 0; index--) {
      const cursor = cursors[index]!
      if (this.indexOf(recordKey(cursor)) < 0) this.insert(--this.first, cursor)
    }
    for (const record of visible) this.summaries.set(recordKey(record), record)
  }
  retain(keys: ReadonlySet<string>): void {
    for (const key of this.summaries.keys()) if (!keys.has(key)) this.summaries.delete(key)
  }
}

/** A burst can span many pages. Do not join disconnected ranges: read through
 * the first known identity, keeping only compact cursors beyond the first page.
 * A failed/interrupted bridge leaves the previously admitted history intact. */
export async function readHistoryPrefix(
  history: RecordHistory,
  read: (after: RecordCursor | null) => Promise<RecordsPage>,
  current: () => boolean,
): Promise<{ cursors: RecordCursor[]; first: RecordsPage; incomplete: boolean } | null> {
  const first = await read(null)
  if (!current()) return null
  const cursors: RecordCursor[] = []
  let page = first
  let incomplete = first.searchIncomplete === true
  while (true) {
    for (const record of page.records) {
      if (history.indexOf(recordKey(record)) >= 0) return { cursors, first, incomplete }
      cursors.push({ time: record.time, kind: record.kind, id: record.id })
    }
    if (!history.count || !page.more || !page.records.length) return { cursors, first, incomplete }
    const last = page.records.at(-1)!
    page = await read({ time: last.time, kind: last.kind, id: last.id })
    if (!current()) return null
    incomplete ||= page.searchIncomplete === true
  }
}
