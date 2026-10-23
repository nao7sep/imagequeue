import type { MessageKey } from '../../../shared/i18n/catalogues'
import type { RecordKind, RecordLevel, RecordLevelFilter } from '../../../shared/records'

export function recordKey(record: { kind: RecordKind; id: number }): string {
  return `${record.kind}:${record.id}`
}

function isEmptyValue(value: unknown): boolean {
  if (value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value).length === 0
  return false
}

// A JSON column as its detail block shows it, indented for reading, text that
// is not JSON as it is; or null when there is nothing in it to show: no value,
// `null`, an empty object, array or string, or only whitespace. Such a block is
// left out rather than shown empty.
export function jsonBlockText(text: string | null): string | null {
  if (text === null || text.trim() === '') return null
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return text
  }
  return isEmptyValue(value) ? null : JSON.stringify(value, null, 2)
}

export const KIND_LABELS: Record<RecordKind, MessageKey> = {
  log: 'records.kindLog',
  'ai-call': 'records.kindAiCall',
  'cli-job': 'records.kindCliJob',
}

// A CLI job's stored status, as the detail names it.
export const CLI_JOB_STATUS_LABELS: Partial<Record<string, MessageKey>> = {
  exited: 'records.statusExited',
  killed: 'records.statusKilled',
  'timed-out': 'records.statusTimedOut',
}

export const LEVEL_LABELS: Record<RecordLevel, MessageKey> = {
  error: 'records.levelError',
  warn: 'records.levelWarn',
  info: 'records.levelInfo',
  debug: 'records.levelDebug',
}

export const LEVEL_FILTER_LABELS: Record<RecordLevelFilter, MessageKey> = {
  attention: 'records.levelAttention',
  ...LEVEL_LABELS,
}
