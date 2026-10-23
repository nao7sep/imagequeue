import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import {
  RECORDS_PAGE_SIZE,
  type RecordDetail,
  type RecordKind,
  type RecordsPage,
  type RecordsQuery,
  type RecordsRead,
  type RecordsReadResults,
  type RecordSummary,
} from '../shared/records'

// The Records window's reads of records.sqlite3 (records.ts owns the schema and
// every write). Pages are keyset-paged, newest first, across every table.

// An AI call has no level of its own; a failed one reads as an error.
const CALL_LEVEL = "CASE WHEN error IS NULL THEN 'info' ELSE 'error' END"
// Nor has a CLI job: one stopped by the user reads as a warning, and one that
// did not exit with 0 as an error.
const JOB_LEVEL = "CASE WHEN status = 'killed' THEN 'warn' WHEN error IS NULL AND exit_code = 0 THEN 'info' ELSE 'error' END"
const JOB_TITLE = "'draw-things-cli ' || job_kind"
const LOG_SEARCHED = ['message', 'session_id', 'task_id', 'request_id', 'fields']
const CALL_SEARCHED = ['backend', 'model', 'purpose', 'session_id', 'task_id', 'request_id', 'request', 'response', 'error']
const JOB_SEARCHED = ['job_kind', 'target', 'cli_path', 'args', 'session_id', 'job_id', 'status', 'stdout', 'stderr', 'error']

function likePattern(search: string): string | null {
  const trimmed = search.trim()
  return trimmed === '' ? null : `%${trimmed.replace(/[\\%_]/g, (match) => `\\${match}`)}%`
}

export function readPage(db: DatabaseSync, query: RecordsQuery): RecordsPage {
  const pattern = likePattern(query.search)
  const candidates: RecordSummary[] = []
  const table = (kind: RecordKind, select: string, from: string, level: string, searched: string[]): void => {
    const params: SQLInputValue[] = []
    const where = ['1 = 1']
    if (query.launch !== null) {
      where.push('launch = ?')
      params.push(query.launch)
    }
    if (query.session !== null) {
      where.push('session_id = ?')
      params.push(query.session)
    }
    if (query.level === 'attention') {
      where.push(`${level} IN ('warn', 'error')`)
    } else if (query.level !== null) {
      where.push(`${level} = ?`)
      params.push(query.level)
    }
    if (pattern !== null) {
      where.push(`(${searched.map((column) => `${column} LIKE ? ESCAPE '\\'`).join(' OR ')})`)
      params.push(...searched.map(() => pattern))
    }
    if (query.after) {
      const after = query.after
      if (kind === after.kind) {
        where.push('time <= ? AND (time < ? OR id < ?)')
        params.push(after.time, after.time, after.id)
      } else {
        where.push(kind < after.kind ? 'time <= ?' : 'time < ?')
        params.push(after.time)
      }
    }
    // Each source uses its own ordered index. Sorting only the bounded merge
    // avoids SQLite sorting an entire union on a constant source-kind column.
    params.push(RECORDS_PAGE_SIZE + 1)
    candidates.push(...db.prepare(`${select} FROM ${from} WHERE ${where.join(' AND ')} ORDER BY time DESC, id DESC LIMIT ?`).all(...params) as unknown as RecordSummary[])
  }
  if (query.kind === null || query.kind === 'log') {
    table('log', "SELECT 'log' AS kind, id, time, level, message AS title, NULL AS text", 'log_records', 'level', LOG_SEARCHED)
  }
  if (query.kind === null || query.kind === 'ai-call') {
    table('ai-call',
      `SELECT 'ai-call' AS kind, id, time, ${CALL_LEVEL} AS level, backend || ' ' || purpose AS title, model AS text`,
      'ai_calls', CALL_LEVEL, CALL_SEARCHED,
    )
  }
  if (query.kind === null || query.kind === 'cli-job') {
    table('cli-job',
      `SELECT 'cli-job' AS kind, id, time, ${JOB_LEVEL} AS level, ${JOB_TITLE} AS title, target AS text`,
      'cli_jobs', JOB_LEVEL, JOB_SEARCHED,
    )
  }
  const descending = (a: string, b: string): number => a === b ? 0 : a < b ? 1 : -1
  candidates.sort((a, b) => descending(a.time, b.time) || descending(a.kind, b.kind) || b.id - a.id)
  return { records: candidates.slice(0, RECORDS_PAGE_SIZE), more: candidates.length > RECORDS_PAGE_SIZE }
}

export function readSources(db: DatabaseSync): RecordsReadResults['sources'] {
  const launches = db.prepare(
    'SELECT launch FROM log_records UNION SELECT launch FROM ai_calls UNION SELECT launch FROM cli_jobs ORDER BY launch DESC',
  ).all() as { launch: string }[]
  const sessions = db.prepare(
    `SELECT session_id AS session, MAX(time) AS last FROM (
      SELECT session_id, time FROM log_records UNION ALL SELECT session_id, time FROM ai_calls
      UNION ALL SELECT session_id, time FROM cli_jobs
    ) WHERE session_id IS NOT NULL GROUP BY session_id ORDER BY last DESC`,
  ).all() as { session: string }[]
  return { launches: launches.map((row) => row.launch), sessions: sessions.map((row) => row.session) }
}

export function readDetail(db: DatabaseSync, kind: RecordKind, id: number): RecordDetail | null {
  if (kind === 'log') {
    const row = db.prepare(
      `SELECT 'log' AS kind, id, time, launch, session_id AS sessionId, task_id AS taskId, request_id AS requestId,
        level, message, fields FROM log_records WHERE id = ?`,
    ).get(id)
    return (row as unknown as RecordDetail | undefined) ?? null
  }
  if (kind === 'cli-job') {
    const row = db.prepare(
      `SELECT 'cli-job' AS kind, id, time, launch, session_id AS sessionId, ${JOB_LEVEL} AS level, ${JOB_TITLE} AS title,
        job_id AS jobId, job_kind AS jobKind, target, cli_path AS cliPath, args, started_at AS startedAt,
        ended_at AS endedAt, status, exit_code AS exitCode, signal, stdout, stderr, error FROM cli_jobs WHERE id = ?`,
    ).get(id)
    return (row as unknown as RecordDetail | undefined) ?? null
  }
  const row = db.prepare(
    `SELECT 'ai-call' AS kind, id, time, launch, session_id AS sessionId, task_id AS taskId, request_id AS requestId,
      backend, model, purpose, duration_ms AS durationMs, request, response, error FROM ai_calls WHERE id = ?`,
  ).get(id)
  return (row as unknown as RecordDetail | undefined) ?? null
}

export function runRecordsRead(db: DatabaseSync, read: RecordsRead): RecordsReadResults[RecordsRead['op']] {
  if (read.op === 'page') return readPage(db, read.query)
  if (read.op === 'sources') return readSources(db)
  return readDetail(db, read.kind, read.id)
}
