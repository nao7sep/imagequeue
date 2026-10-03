import {
  RECORD_KINDS,
  RECORD_LEVEL_FILTERS,
  type RecordDetail,
  type RecordKind,
  type RecordLevelFilter,
  type RecordSources,
  type RecordsPage,
  type RecordsQuery,
} from '../shared/records'
import { handle } from './ipc-boundary'
import { currentRecordsContext } from './records'
import { readRecords } from './records-reader'
import { openRecordsWindow } from './records-window'

export function assertRecordKind(value: unknown): asserts value is RecordKind {
  if (!RECORD_KINDS.includes(value as RecordKind)) {
    throw new Error('Invalid IPC parameter: kind must be a record kind.')
  }
}

export function assertRecordsQuery(value: unknown): asserts value is RecordsQuery {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid IPC parameter: query must be an object.')
  }
  const query = value as Record<string, unknown>
  for (const name of ['launch', 'session'] as const) {
    if (query[name] !== null && typeof query[name] !== 'string') {
      throw new Error(`Invalid IPC parameter: query.${name} must be a string or null.`)
    }
  }
  if (query.kind !== null) assertRecordKind(query.kind)
  if (query.level !== null && !RECORD_LEVEL_FILTERS.includes(query.level as RecordLevelFilter)) {
    throw new Error('Invalid IPC parameter: query.level must be a record level filter or null.')
  }
  if (typeof query.search !== 'string') {
    throw new Error('Invalid IPC parameter: query.search must be a string.')
  }
  if (query.after !== null) {
    const after = query.after as Record<string, unknown> | undefined
    if (typeof after !== 'object' || after === null || typeof after.time !== 'string' || !Number.isInteger(after.id)) {
      throw new Error('Invalid IPC parameter: query.after must be a record cursor or null.')
    }
    assertRecordKind(after.kind)
  }
}

export async function readRecordSources(): Promise<RecordSources> {
  const { launches, sessions } = await readRecords({ op: 'sources' })
  const { launch, session } = currentRecordsContext()
  return { currentLaunch: launch, currentSession: session, launches, sessions }
}

export function registerRecordsIpc(): void {
  handle('records:open', () => openRecordsWindow())
  handle('records:page', (_event, query: unknown): Promise<RecordsPage> => {
    assertRecordsQuery(query)
    return readRecords({ op: 'page', query })
  })
  handle('records:detail', (_event, kind: unknown, id: unknown): Promise<RecordDetail | null> => {
    assertRecordKind(kind)
    if (!Number.isInteger(id)) throw new Error('Invalid IPC parameter: id must be an integer.')
    return readRecords({ op: 'detail', kind, id: id as number })
  })
  handle('records:sources', () => readRecordSources())
}
