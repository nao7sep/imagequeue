import fs from 'node:fs'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { serializeError } from '../shared/serialize-error'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import {
  RECORDS_PAGE_SIZE,
  RECORDS_OUTPUT_PAGE_SIZE,
  type RecordOutputStream,
  type RecordsOutputPage,
  type RecordDetail,
  type RecordKind,
  type RecordsPage,
  type RecordsQuery,
  type RecordsRead,
  type RecordsReadResults,
  type RecordSummary,
} from '../shared/records'

// The Records window's reads of records.sqlite3 (records-storage.ts owns the
// schema; the records thread runs every write and these reads in order). Pages are keyset-paged, newest first, across every table.

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

export interface RecordsSearchWarning {
  unavailableInputs: number
  first: { jobId: number; stream: RecordOutputStream; reference: string | null; error: Record<string, unknown> }
}

export function readPage(db: DatabaseSync, query: RecordsQuery, reportWarning?: (warning: RecordsSearchWarning) => void): RecordsPage {
  const pattern = likePattern(query.search)
  const search = pattern === null ? null : registerOutputSearch(db)
  if (search) search.warning = null
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
      const terms = searched.map((column) => `${column} LIKE ? ESCAPE '\\'`)
      params.push(...searched.map(() => pattern))
      if (kind === 'cli-job') {
        for (const stream of ['stdout', 'stderr']) {
          terms.push(`cli_output_contains(${stream}_file, ?, '${stream}', output_error, id)`)
          params.push(query.search.trim())
        }
      }
      where.push(`(${terms.join(' OR ')})`)
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
  if (search?.warning) reportWarning?.(search.warning)
  return { records: candidates.slice(0, RECORDS_PAGE_SIZE), more: candidates.length > RECORDS_PAGE_SIZE,
    ...(search?.warning ? { searchIncomplete: true as const } : {}),
  }
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
        ended_at AS endedAt, status, exit_code AS exitCode, signal,
        (stdout_file IS NOT NULL OR LENGTH(CAST(stdout AS BLOB)) > 0) AS hasStdout,
        (stderr_file IS NOT NULL OR LENGTH(CAST(stderr AS BLOB)) > 0) AS hasStderr,
        output_error AS outputError, error FROM cli_jobs WHERE id = ?`,
    ).get(id)
    if (!row) return null
    return { ...row, hasStdout: Boolean(row.hasStdout), hasStderr: Boolean(row.hasStderr) } as unknown as RecordDetail
  }
  const row = db.prepare(
    `SELECT 'ai-call' AS kind, id, time, launch, session_id AS sessionId, task_id AS taskId, request_id AS requestId,
      backend, model, purpose, duration_ms AS durationMs, request, response, error FROM ai_calls WHERE id = ?`,
  ).get(id)
  return (row as unknown as RecordDetail | undefined) ?? null
}

export function runRecordsRead(db: DatabaseSync, read: RecordsRead, reportWarning?: (warning: RecordsSearchWarning) => void): RecordsReadResults[RecordsRead['op']] {
  if (read.op === 'page') return readPage(db, read.query, reportWarning)
  if (read.op === 'sources') return readSources(db)
  if (read.op === 'output') return readOutput(db, read.id, read.stream, read.offset)
  return readDetail(db, read.kind, read.id)
}

function outputDirectory(db: DatabaseSync): string {
  const main = (db.prepare('PRAGMA database_list').all() as { name: string; file: string }[]).find((entry) => entry.name === 'main')!
  return path.join(path.dirname(main.file), 'records', 'cli')
}

function outputPath(directory: string, reference: string, stream: RecordOutputStream): string {
  // Only writer-owned basenames belong here; validation prevents path
  // traversal through a modified reference.
  const match = /^(\d{8}-\d{6}-utc)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(stdout|stderr)\.log$/.exec(reference)
  if (!match || match[2] !== stream) throw new Error('Invalid CLI output file reference.')
  return path.join(directory, reference)
}

/** Off-thread reader only: one bounded UTF-8 chunk, ending at a character boundary. */
export function readOutput(db: DatabaseSync, id: number, stream: RecordOutputStream, offset: number): RecordsOutputPage {
  const row = db.prepare(`SELECT ${stream}_file AS file FROM cli_jobs WHERE id = ?`).get(id) as { file: string | null } | undefined
  if (!row) throw new Error('The CLI job record no longer exists.')
  if (row.file === null) {
    // BLOB substr uses byte offsets and preserves embedded NULs in historical
    // SQLite TEXT. TEXT length/substr would stop at the first NUL.
    const legacy = db.prepare(`SELECT substr(CAST(${stream} AS BLOB), ?, ?) AS bytes FROM cli_jobs WHERE id = ?`)
      .get(offset + 1, RECORDS_OUTPUT_PAGE_SIZE + 4, id) as { bytes: Uint8Array | null }
    // SQLite returns NULL for an empty BLOB substring, including empty output.
    return outputChunk(legacy.bytes === null ? Buffer.alloc(0) : Buffer.from(legacy.bytes), offset)
  }
  const file = fs.openSync(outputPath(outputDirectory(db), row.file, stream), 'r')
  try {
    // Three continuation bytes may finish the final code point; one more byte
    // establishes whether another page exists without decoding the whole file.
    const buffer = Buffer.allocUnsafe(RECORDS_OUTPUT_PAGE_SIZE + 4)
    let length = 0
    while (length < buffer.length) {
      const count = fs.readSync(file, buffer, length, buffer.length - length, offset + length)
      if (count === 0) break
      length += count
    }
    return outputChunk(buffer.subarray(0, length), offset)
  } finally { fs.closeSync(file) }
}

function outputChunk(buffer: Buffer, offset: number): RecordsOutputPage {
  if (buffer.length > 0 && (buffer[0] & 0xc0) === 0x80) throw new Error('Invalid CLI output cursor: not a UTF-8 character boundary.')
  let end = Math.min(RECORDS_OUTPUT_PAGE_SIZE, buffer.length)
  while (end < buffer.length && (buffer[end] & 0xc0) === 0x80) end++
  return { text: buffer.toString('utf8', 0, end), nextOffset: end < buffer.length ? offset + end : null }
}

interface OutputSearch { warning: RecordsSearchWarning | null }
const searchConnections = new WeakMap<DatabaseSync, OutputSearch>()
const asciiLower = (value: string): string => value.replace(/[A-Z]/g, (character) => character.toLowerCase())
function registerOutputSearch(db: DatabaseSync): OutputSearch {
  const existing = searchConnections.get(db)
  if (existing) return existing
  const directory = outputDirectory(db)
  const state: OutputSearch = { warning: null }
  // A shared storage failure can affect many files. Retain its first complete
  // diagnostic and the affected-input count, without accumulating errors for
  // an entire history. The caller presents incomplete results and pauses live
  // retry, so recording this warning cannot create a refresh/log loop.
  db.function('cli_output_contains', (reference, needle, stream, captureError, jobId) => {
    let unavailable = false
    const note = (error: Record<string, unknown>): void => {
      if (unavailable) return
      unavailable = true
      if (state.warning) state.warning.unavailableInputs++
      else state.warning = { unavailableInputs: 1, first: {
        jobId: Number(jobId), stream: stream as RecordOutputStream,
        reference: reference === null ? null : String(reference), error,
      } }
    }
    if (reference === null) {
      if (captureError !== null) note({ captureError })
      return 0
    }
    try {
      const file = fs.openSync(outputPath(directory, String(reference), stream as RecordOutputStream), 'r')
      try {
        const wanted = asciiLower(String(needle))
        const decoder = new StringDecoder('utf8')
        const buffer = Buffer.allocUnsafe(RECORDS_OUTPUT_PAGE_SIZE)
        let tail = ''
        for (;;) {
          const length = fs.readSync(file, buffer, 0, buffer.length, null)
          const chunk = tail + asciiLower(length ? decoder.write(buffer.subarray(0, length)) : decoder.end())
          if (chunk.includes(wanted)) return 1
          if (!length) return 0
          tail = wanted.length > 1 ? chunk.slice(-(wanted.length - 1)) : ''
        }
      } finally { fs.closeSync(file) }
    } catch (error) {
      note({ ...serializeError(error), ...(captureError !== null ? { captureError } : {}) })
      return 0
    } finally {
      if (captureError !== null && !unavailable) note({ captureError })
    }
  })
  searchConnections.set(db, state)
  return state
}
