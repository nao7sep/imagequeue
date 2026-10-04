// What the Records window reads from records.sqlite3: a filtered page of
// summaries, newest first, and one record whole. JSON columns arrive as the
// text the database holds; the window decides how to show them.

export type RecordKind = 'log' | 'ai-call' | 'cli-job'

export type RecordLevel = 'debug' | 'info' | 'warn' | 'error'

export const RECORD_KINDS: readonly RecordKind[] = ['log', 'ai-call', 'cli-job']

export const RECORD_LEVELS: readonly RecordLevel[] = ['error', 'warn', 'info', 'debug']

// What the level filter offers: a record's own level, or `attention`, every
// record at `warn` or `error`.
export type RecordLevelFilter = 'attention' | RecordLevel

export const RECORD_LEVEL_FILTERS: readonly RecordLevelFilter[] = ['attention', ...RECORD_LEVELS]

export const RECORDS_PAGE_SIZE = 100

// Where the next page starts: the last summary of the page before it.
export interface RecordCursor {
  time: string
  kind: RecordKind
  id: number
}

export interface RecordsQuery {
  // A process launch, by its start time.
  launch: string | null
  // An imagequeue session, by its id.
  session: string | null
  kind: RecordKind | null
  // An AI call reads as `error` when it failed and `info` otherwise; a CLI job
  // as `info` when it exited with 0, `warn` when it was stopped, and `error`
  // otherwise.
  level: RecordLevelFilter | null
  search: string
  after: RecordCursor | null
}

export interface RecordSummary {
  kind: RecordKind
  id: number
  time: string
  level: RecordLevel
  // A log line's message, an AI call's backend and purpose, or the CLI and a
  // CLI job's kind.
  title: string
  // An AI call's model or a CLI job's target; a log line has none.
  text: string | null
}

export interface RecordsPage {
  records: RecordSummary[]
  more: boolean
}

export interface LogRecordDetail {
  kind: 'log'
  id: number
  time: string
  launch: string
  sessionId: string | null
  taskId: string | null
  requestId: string | null
  level: RecordLevel
  message: string
  fields: string
}

export interface AiCallRecordDetail {
  kind: 'ai-call'
  id: number
  time: string
  launch: string
  sessionId: string | null
  taskId: string | null
  requestId: string | null
  backend: string
  model: string
  purpose: string
  durationMs: number
  request: string
  response: string | null
  error: string | null
}

export interface CliJobRecordDetail {
  kind: 'cli-job'
  id: number
  time: string
  launch: string
  sessionId: string | null
  // Read from the stored facts, as the summary reads them.
  level: RecordLevel
  title: string
  jobId: string
  jobKind: string
  target: string
  cliPath: string
  args: string
  startedAt: string | null
  endedAt: string
  status: string
  exitCode: number | null
  signal: string | null
  stdout: string
  stderr: string
  error: string | null
}

export type RecordDetail = LogRecordDetail | AiCallRecordDetail | CliJobRecordDetail

// What the Records window asks of the database.
export type RecordsRead =
  | { op: 'page'; query: RecordsQuery }
  | { op: 'sources' }
  | { op: 'detail'; kind: RecordKind; id: number }

export interface RecordsReadResults {
  page: RecordsPage
  sources: { launches: string[]; sessions: string[] }
  detail: RecordDetail | null
}

// The values the filters offer: every launch and every session that has
// records, newest first, and the ones open now.
export interface RecordSources {
  currentLaunch: string
  currentSession: string | null
  launches: string[]
  sessions: string[]
}
