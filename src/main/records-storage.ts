import fs from 'fs'
import path from 'path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { serializeError } from '../shared/serialize-error'
import { utcStampForFilename } from '../shared/utc-stamp'
import { setAsideFile } from './utils/set-aside'
import { openSqliteStore, FORMAT_VERSIONS, MissingFormatError } from './store-format'

// The app's records, per the logging-conventions and the data-lifecycle-conventions'
// Records: one `records.sqlite3` under the storage root, written only by the main
// process's dedicated writer thread. Every row carries `time`; `launch`, this process launch by its start time
// (the conventions' session); `session_id`, the imagequeue session open at the time,
// null before one opens; and the domain ids it belongs to, `task_id` (a queued image)
// and `request_id` (an elaboration run), or a Draw Things CLI job's `job_id`.
// Nothing here deletes a row.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS log_records (
  id         INTEGER PRIMARY KEY,
  time       TEXT NOT NULL,
  launch     TEXT NOT NULL,
  session_id TEXT,
  task_id    TEXT,
  request_id TEXT,
  level      TEXT NOT NULL,
  message    TEXT NOT NULL,
  fields     TEXT NOT NULL    -- JSON object: every other field the caller gave
);
CREATE INDEX IF NOT EXISTS log_records_session ON log_records (session_id);
CREATE TABLE IF NOT EXISTS ai_calls (
  id          INTEGER PRIMARY KEY,
  time        TEXT NOT NULL,  -- when the request was sent
  launch      TEXT NOT NULL,
  session_id  TEXT,
  task_id     TEXT,
  request_id  TEXT,
  backend     TEXT NOT NULL,
  model       TEXT NOT NULL,
  purpose     TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  request     TEXT NOT NULL,  -- JSON: the request as sent
  response    TEXT,           -- JSON: the response as received, image bytes left out; null when none arrived
  error       TEXT            -- JSON: the failure, null on success
);
CREATE INDEX IF NOT EXISTS ai_calls_session ON ai_calls (session_id);
CREATE TABLE IF NOT EXISTS cli_jobs (
  id         INTEGER PRIMARY KEY,
  time       TEXT NOT NULL,  -- when the job was asked for
  launch     TEXT NOT NULL,
  session_id TEXT,
  job_id     TEXT NOT NULL,  -- as the job's log lines carry it
  job_kind   TEXT NOT NULL,  -- import or download
  target     TEXT NOT NULL,
  cli_path   TEXT NOT NULL,
  args       TEXT NOT NULL,  -- JSON array: the arguments as passed
  started_at TEXT,           -- when the process was started; null when it never was
  ended_at   TEXT NOT NULL,
  status     TEXT NOT NULL,  -- exited, or killed when stopped
  exit_code  INTEGER,
  signal     TEXT,           -- as the process runner reported it
  stdout     TEXT NOT NULL,  -- as received, whole
  stderr     TEXT NOT NULL,
  error      TEXT            -- JSON: the error the process runner reported, null when none
);
CREATE INDEX IF NOT EXISTS cli_jobs_session ON cli_jobs (session_id);
`

type Table = 'log_records' | 'ai_calls' | 'cli_jobs'
type Row = Record<string, string | number | null>

let launchStarted = new Date()
let launch = launchStarted.toISOString()
let activeSessionId: string | null = null
let db: DatabaseSync | null = null
let inserts: Record<Table, StatementSync> | null = null
let fallbackFile: string | null = null
let databaseFile: string | null = null
let storedListener: (() => void) | null = null

function insertStatement(store: DatabaseSync, table: Table, columns: string[]): StatementSync {
  return store.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => `:${c}`).join(', ')})`)
}

// A populated database without a format version is set aside, never deleted,
// and a new one is created in its place; the records are diagnostics, so the
// record naming the copy is the whole report. A copy that cannot be made throws.
function openOrReplace(file: string): { opened: DatabaseSync; movedTo: string | null } {
  try {
    return { opened: openSqliteStore(file, FORMAT_VERSIONS.records, SCHEMA), movedTo: null }
  } catch (error) {
    if (!(error instanceof MissingFormatError)) throw error
    const movedTo = setAsideFile(file)
    return { opened: openSqliteStore(file, FORMAT_VERSIONS.records, SCHEMA), movedTo }
  }
}

/** Opens `records.sqlite3` under `dataDir`; a failed open sends every record to the
 *  plain text file under `logs/`. Returns the database path. */
export function openRecords(dataDir: string, context?: { launch: string }): string {
  closeRecords()
  if (context) { launch = context.launch; launchStarted = new Date(launch) }
  const file = path.join(dataDir, 'records.sqlite3')
  fallbackFile = path.join(dataDir, 'logs', `${utcStampForFilename(launchStarted)}.log`)
  let opened: DatabaseSync | undefined
  let movedTo: string | null = null
  try {
    const result = openOrReplace(file)
    opened = result.opened
    movedTo = result.movedTo
    inserts = {
      log_records: insertStatement(opened, 'log_records', ['time', 'launch', 'session_id', 'task_id', 'request_id', 'level', 'message', 'fields']),
      ai_calls: insertStatement(opened, 'ai_calls', ['time', 'launch', 'session_id', 'task_id', 'request_id', 'backend', 'model', 'purpose', 'duration_ms', 'request', 'response', 'error']),
      cli_jobs: insertStatement(opened, 'cli_jobs', ['time', 'launch', 'session_id', 'job_id', 'job_kind', 'target', 'cli_path', 'args', 'started_at', 'ended_at', 'status', 'exit_code', 'signal', 'stdout', 'stderr', 'error']),
    }
    db = opened
    databaseFile = file
  } catch (error) {
    try {
      opened?.close()
    } catch (closeError) {
      console.error('[records] closing the records database failed', closeError)
    }
    reportFailure('Records database could not be opened', error)
  }
  if (movedTo) {
    writeLogRecord(new Date().toISOString(), 'warn', 'Set aside a records database without a format version; started a new one', { from: file, to: movedTo })
  }
  return file
}

/** Releases the database; later records go to the console until it is opened again. */
export function closeRecords(): void {
  try {
    db?.close()
  } catch (error) {
    console.error('[records] closing the records database failed', error)
  }
  db = null
  inserts = null
  fallbackFile = null
  databaseFile = null
}

/** The open database's path, for the Records window's reader; null while closed. */
export function recordsDatabasePath(): string | null {
  return databaseFile
}

/** Called after each record the database stored; a record kept in the fallback
 *  file is not in the database, so it calls nothing. */
export function onRecordStored(listener: (() => void) | null): void {
  storedListener = listener
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null'
  } catch (error) {
    return JSON.stringify({ recordSerializeError: String(error) })
  }
}

const JSON_COLUMNS: ReadonlySet<string> = new Set(['fields', 'request', 'response', 'error', 'args'])

// A failed write keeps the entry in the launch's plain text file, then the console,
// as one JSON line with its JSON columns inline.
function writeFallback(table: Table, row: Row): void {
  const members = Object.entries({ table, ...row }).map(([key, value]) =>
    `${JSON.stringify(key)}:${JSON_COLUMNS.has(key) && typeof value === 'string' ? value : JSON.stringify(value)}`)
  const line = `{${members.join(',')}}\n`
  if (fallbackFile) {
    try {
      fs.mkdirSync(path.dirname(fallbackFile), { recursive: true })
      fs.appendFileSync(fallbackFile, line, 'utf-8')
      return
    } catch (error) {
      console.error('[records] the fallback file could not be written', error)
    }
  }
  const sink = row.level === 'error' || row.level === 'warn' || row.error ? console.error : console.log
  sink(line.trimEnd())
}

function reportFailure(message: string, error: unknown): void {
  console.error(`[records] ${message}`, error)
  writeFallback('log_records', {
    time: new Date().toISOString(), launch, session_id: activeSessionId, task_id: null, request_id: null,
    level: 'error', message, fields: json({ error: serializeError(error) }),
  })
}

export function write(table: Table, row: Row): void {
  activeSessionId = typeof row.session_id === 'string' ? row.session_id : null
  if (inserts) {
    try {
      inserts[table].run(row)
    } catch (error) {
      reportFailure('Records database write failed', error)
      writeFallback(table, row)
      return
    }
    try {
      storedListener?.()
    } catch (error) {
      console.error('[records] the stored-record listener failed', error)
    }
    return
  }
  writeFallback(table, row)
}

/** One log line: the envelope plus the caller's fields, `taskId` and `requestId` kept
 *  in their own columns. */
export function writeLogRecord(time: string, level: string, message: string, fields: Record<string, unknown>): void {
  const rest = { ...fields }
  const taskId = typeof rest.taskId === 'string' ? rest.taskId : null
  const requestId = typeof rest.requestId === 'string' ? rest.requestId : null
  if (taskId !== null) delete rest.taskId
  if (requestId !== null) delete rest.requestId
  write('log_records', {
    time, launch, session_id: activeSessionId, task_id: taskId, request_id: requestId, level, message, fields: json(rest),
  })
}
