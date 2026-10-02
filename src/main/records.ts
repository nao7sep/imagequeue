import fs from 'fs'
import path from 'path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { serializeError } from '../shared/serialize-error'
import { utcStampForFilename } from '../shared/utc-stamp'

// The app's records, per the logging-conventions and the data-lifecycle-conventions'
// Records: one `records.sqlite3` under the storage root, written only by the main
// process. Every row carries `time`; `launch`, this process launch by its start time
// (the conventions' session); `session_id`, the imagequeue session open at the time,
// null before one opens; and the domain ids it belongs to, `task_id` (a queued image)
// and `request_id` (an elaboration run). Nothing here deletes a row.

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
`

type Table = 'log_records' | 'ai_calls'
type Row = Record<string, string | number | null>

const launchStarted = new Date()
const launch = launchStarted.toISOString()
let activeSessionId: string | null = null
let db: DatabaseSync | null = null
let inserts: Record<Table, StatementSync> | null = null
let fallbackFile: string | null = null

function insertStatement(store: DatabaseSync, table: Table, columns: string[]): StatementSync {
  return store.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => `:${c}`).join(', ')})`)
}

/** Opens `records.sqlite3` under `dataDir`; a failed open sends every record to the
 *  plain text file under `logs/`. Returns the database path. */
export function openRecords(dataDir: string): string {
  closeRecords()
  const file = path.join(dataDir, 'records.sqlite3')
  fallbackFile = path.join(dataDir, 'logs', `${utcStampForFilename(launchStarted)}.log`)
  try {
    const opened = new DatabaseSync(file)
    opened.exec('PRAGMA journal_mode = WAL')
    opened.exec(SCHEMA)
    inserts = {
      log_records: insertStatement(opened, 'log_records', ['time', 'launch', 'session_id', 'task_id', 'request_id', 'level', 'message', 'fields']),
      ai_calls: insertStatement(opened, 'ai_calls', ['time', 'launch', 'session_id', 'task_id', 'request_id', 'backend', 'model', 'purpose', 'duration_ms', 'request', 'response', 'error']),
    }
    db = opened
  } catch (error) {
    reportFailure('Records database could not be opened', error)
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
}

/** The imagequeue session whose id later records carry. */
export function setRecordsSession(sessionId: string): void {
  activeSessionId = sessionId
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null'
  } catch (error) {
    return JSON.stringify({ recordSerializeError: String(error) })
  }
}

const JSON_COLUMNS: ReadonlySet<string> = new Set(['fields', 'request', 'response', 'error'])

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

function write(table: Table, row: Row): void {
  if (inserts) {
    try {
      inserts[table].run(row)
      return
    } catch (error) {
      reportFailure('Records database write failed', error)
    }
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

/** What a call to an AI model is for and what it was sent. */
export interface AiCall {
  backend: string
  model: string
  purpose: string
  taskId?: string
  requestId?: string
  request: unknown
}

export interface AiCallRecord {
  finish(response: unknown): void
  fail(error: unknown, response?: unknown): void
}

/** Starts one call's record at the moment its request is sent; the record is written
 *  once, when the call first finishes or fails. */
export function startAiCall(call: AiCall): AiCallRecord {
  const started = Date.now()
  const base = {
    time: new Date(started).toISOString(), launch, session_id: activeSessionId,
    task_id: call.taskId ?? null, request_id: call.requestId ?? null,
    backend: call.backend, model: call.model, purpose: call.purpose, request: json(call.request),
  }
  let written = false
  const end = (response: unknown, error: unknown): void => {
    if (written) return
    written = true
    write('ai_calls', {
      ...base, duration_ms: Date.now() - started,
      response: response === undefined ? null : json(response),
      error: error === undefined ? null : json(serializeError(error)),
    })
  }
  return {
    finish: (response) => end(response, undefined),
    fail: (error, response) => end(response, error),
  }
}

/** Sends one request and records it; `kept` gives what of a response is kept. */
export async function recordAiCall<T>(call: AiCall, send: () => Promise<T>, kept: (response: T) => unknown = (response) => response): Promise<T> {
  const record = startAiCall(call)
  let response: T
  try {
    response = await send()
  } catch (error) {
    record.fail(error)
    throw error
  }
  record.finish(kept(response))
  return response
}

/** Sends one HTTP request and records it with the answer's status, headers and body,
 *  read whole; `kept` gives what of a JSON body is kept. */
export async function fetchRecorded(
  call: AiCall,
  url: string,
  init: RequestInit,
  kept: (parsed: unknown) => unknown = (parsed) => parsed,
): Promise<{ response: Response; text: string }> {
  return recordAiCall(call, async () => {
    const response = await fetch(url, init)
    return { response, text: await response.text() }
  }, ({ response, text }) => {
    let body: unknown
    try {
      body = kept(JSON.parse(text))
    } catch {
      body = text
    }
    return { status: response.status, headers: Object.fromEntries(response.headers), body }
  })
}
