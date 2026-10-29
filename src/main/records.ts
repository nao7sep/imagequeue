import type { Worker } from 'node:worker_threads'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { utcStampForFilename } from '../shared/utc-stamp'
import { createCliOutputWriter } from './cli-output-writer'
import createRecordsWorker from './records-writer-worker?nodeWorker'
import { serializeError } from '../shared/serialize-error'
import type { RecordsRead, RecordsReadResults } from '../shared/records'
import type { RecordsSearchWarning } from './records-query'

type Table = 'log_records' | 'ai_calls' | 'cli_jobs'
type Row = Record<string, string | number | null>
const launch = new Date().toISOString()
let activeSessionId: string | null = null
let worker: Worker | null = null
let databaseFile: string | null = null
let outputRoot: string | null = null
const finishingOutputs = new Set<Promise<void>>()
let storedListener: (() => void) | null = null
let nextId = 0
// Calls may fail long after a key rotates; retain masking knowledge for this
// process so downstream diagnostic and fallback sinks mask the same values.
const diagnosticCredentials = new Set<string>()
// Flush and read replies, routed to their callers by request id.
const pending = new Map<number, { worker: Worker; resolve: (value?: unknown) => void; reject: (error: Error) => void }>()

/** Diagnostics are ordered by the writer's mailbox; paid evidence belongs to session.json. */
export function openRecords(dataDir: string): string {
  void closeRecords()
  outputRoot = path.join(dataDir, 'records', 'cli')
  const file = path.join(dataDir, 'records.sqlite3')
  try {
    const started = createRecordsWorker({ workerData: { dataDir, launch } })
    worker = started
    databaseFile = file
    started.on('message', (message: { type: string; id?: number; available?: boolean; value?: unknown; warning?: RecordsSearchWarning; error?: string }) => {
      if (message.type === 'opened' && worker === started && !message.available) databaseFile = null
      if (message.type === 'stored') {
        try { storedListener?.() } catch (error) { console.error('[records] stored-record listener failed', error) }
      }
      if (message.id === undefined) return
      const request = pending.get(message.id)
      pending.delete(message.id)
      if (message.type !== 'read') { request?.resolve(); return }
      if (message.warning) writeLogRecord(new Date().toISOString(), 'warn', 'CLI output search was incomplete', { ...message.warning })
      if (message.error !== undefined) request?.reject(new Error(message.error))
      else request?.resolve(message.value)
    })
    // A flush waiting on a writer that ended has nothing left to wait for; a
    // read on it has no answer.
    const ended = (): void => {
      if (worker === started) { worker = null; databaseFile = null }
      for (const [id, request] of pending) {
        if (request.worker !== started) continue
        pending.delete(id)
        request.reject(new Error('The records database is not open.'))
      }
    }
    started.on('error', (error) => { console.error('[records] writer failed', error); ended() })
    started.on('exit', ended)
    started.unref()
  } catch (error) { console.error('[records] writer could not start', error) }
  return file
}

export async function flushRecords(): Promise<void> {
  while (finishingOutputs.size > 0) await Promise.all([...finishingOutputs])
  const current = worker
  if (!current) return
  const id = ++nextId
  await new Promise<void>((resolve) => {
    pending.set(id, { worker: current, resolve: () => resolve(), reject: () => resolve() })
    try { current.postMessage({ type: 'flush', id }) }
    catch { pending.delete(id); resolve() }
  })
}

/** A Records window read. It waits for CLI output files still being written,
 *  then runs on the records thread after every record posted before it. */
export async function readRecords<R extends RecordsRead>(read: R): Promise<RecordsReadResults[R['op']]> {
  while (finishingOutputs.size > 0) await Promise.all([...finishingOutputs])
  const current = worker
  if (!current || databaseFile === null) throw new Error('The records database is not open.')
  const id = ++nextId
  return new Promise((resolve, reject) => {
    pending.set(id, { worker: current, resolve: resolve as (value?: unknown) => void, reject })
    try { current.postMessage({ type: 'read', id, read }) }
    catch (error) { pending.delete(id); reject(error instanceof Error ? error : new Error(String(error))) }
  })
}

export async function closeRecords(): Promise<void> {
  const current = worker
  worker = null
  databaseFile = null
  if (finishingOutputs.size > 0) await Promise.all([...finishingOutputs])
  if (!current) return
  const exited = new Promise<void>((resolve) => current.once('exit', () => resolve()))
  current.postMessage({ type: 'close' })
  await exited
}

export function recordsDatabasePath(): string | null { return databaseFile }
export function currentRecordsContext(): { launch: string; session: string | null } { return { launch, session: activeSessionId } }
export function onRecordStored(listener: (() => void) | null): void { storedListener = listener }
export function setRecordsSession(sessionId: string): void { activeSessionId = sessionId }
function json(value: unknown): string {
  try { return JSON.stringify(value) ?? 'null' }
  catch (error) { return JSON.stringify({ recordSerializeError: String(error) }) }
}
function write(table: Table, row: Row, destination = worker): void {
  try {
    if (destination) {
      destination.postMessage({ type: 'write', table, row })
      return
    }
  } catch (error) { console.error('[records] writer could not receive record', error) }
  const sink = row.level === 'error' || row.level === 'warn' || row.error ? console.error : console.log
  const jsonColumns = new Set(['fields', 'request', 'response', 'error', 'output_error', 'args'])
  const members = Object.entries({ table, ...row }).map(([key, value]) =>
    `${JSON.stringify(key)}:${jsonColumns.has(key) && typeof value === 'string' ? value : JSON.stringify(value)}`)
  sink(`{${members.join(',')}}`)
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
    time, launch, session_id: activeSessionId, task_id: taskId, request_id: requestId, level,
    message: maskDiagnostic(message) as string,
    fields: json(maskDiagnostic(JSON.parse(json(rest)))),
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
  /** The key values the call sends. Never recorded: each occurrence in the
   *  record is masked, including one a provider echoes back. */
  credentials?: readonly string[]
}

export interface AiCallRecord {
  finish(response: unknown): void
  fail(error: unknown, response?: unknown): void
}

const MASK = '[REDACTED]'
// Header names that carry a key, compared case-insensitively.
const CREDENTIAL_HEADERS = new Set(['x-key', 'authorization', 'x-goog-api-key', 'api-key'])
// A signed download URL's signature, such as the one FLUX hands back.
const URL_SIGNATURE = /([?&]sig=)[^&#\s"]+/g

/**
 * A copy of a recorded value with every credential masked and its structure
 * kept (logging-conventions): known key headers become `[REDACTED]`, keeping an
 * authorization scheme as `Bearer [REDACTED]`; every occurrence of a key value
 * the call sent, and a signed URL's signature, become `[REDACTED]`. The value
 * itself is never changed, since live request headers are shared with the
 * request being sent.
 */
export function maskCredentials(value: unknown, credentials: readonly string[] = []): unknown {
  const keys = credentials.filter((key) => key.length > 0)
  const ancestors = new Set<object>()
  const maskText = (text: string): string =>
    keys.reduce((masked, key) => masked.split(key).join(MASK), text).replace(URL_SIGNATURE, `$1${MASK}`)
  const visit = (current: unknown, header: string | null): unknown => {
    if (typeof current === 'string') {
      if (header === 'authorization') {
        const scheme = /^(\S+)\s+\S/.exec(current)
        return scheme ? `${scheme[1]} ${MASK}` : MASK
      }
      if (header !== null) return MASK
      return maskText(current)
    }
    if (current && typeof current === 'object') {
      // SDK errors may contain cyclic request/response objects. Mask a copy
      // without losing useful siblings or mistaking shared values for cycles.
      if (ancestors.has(current)) return '[Circular]'
      ancestors.add(current)
      try {
        if (Array.isArray(current)) return current.map((item) => visit(item, null))
        return Object.fromEntries(Object.entries(current).map(([name, item]) => {
          const lower = name.toLowerCase()
          return [maskText(name), visit(item, CREDENTIAL_HEADERS.has(lower) ? lower : null)]
        }))
      } finally { ancestors.delete(current) }
    }
    return current
  }
  return visit(value, null)
}

/** Records and last-resort console sinks share the credentials captured by
 * earlier requests, including keys replaced before a late failure arrives. */
export function maskDiagnostic(value: unknown): unknown {
  return maskCredentials(value, [...diagnosticCredentials])
}

/** Starts one call's record at the moment its request is sent; the record is written
 *  once, when the call first finishes or fails, with the request the call then holds
 *  (an SDK's recordingFetch puts the HTTP request it sent there). */
export function startAiCall(call: AiCall): AiCallRecord {
  for (const key of call.credentials ?? []) if (key) diagnosticCredentials.add(key)
  const started = performance.now()
  const base = {
    time: new Date().toISOString(), launch, session_id: activeSessionId,
    task_id: call.taskId ?? null, request_id: call.requestId ?? null,
    backend: call.backend, model: call.model, purpose: call.purpose,
  }
  let written = false
  const end = (response: unknown, error: unknown): void => {
    if (written) return
    written = true
    // Masked before the row exists, so the database, the fallback file and the
    // console all receive the same masked copy. The JSON form is masked, so a
    // value records exactly as it serializes.
    const masked = (value: unknown): string => json(maskCredentials(JSON.parse(json(value)), call.credentials))
    write('ai_calls', {
      ...base, request: masked(call.request), duration_ms: performance.now() - started,
      response: response === undefined ? null : masked(response),
      error: error === undefined ? null : masked(serializeError(error)),
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

/** A fetch to give an SDK for one call: the HTTP request the SDK sends becomes the
 *  call's recorded request, its URL, method, headers and body whole (data-lifecycle
 *  conventions, Nothing is cut). Until it sends, the call keeps what the app built. */
export function recordingFetch(call: AiCall): typeof fetch {
  return (input, init) => {
    let body: unknown = init?.body ?? null
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch {
        // Not JSON: kept as the text that was sent.
      }
    }
    call.request = {
      url: input instanceof Request ? input.url : String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers)),
      body,
    }
    return fetch(input, init)
  }
}

/** Sends one HTTP request and records it with the answer's status, headers and body,
 *  read whole; `kept` gives what of a JSON body is kept. */
export async function fetchRecorded(
  call: AiCall,
  url: string,
  init: RequestInit,
  kept: (parsed: unknown) => unknown = (parsed) => parsed,
): Promise<{ response: Response; text: string }> {
  const record = startAiCall(call)
  try {
    const response = await fetch(url, init)
    const text = await response.text()
    let body: unknown
    try { body = kept(JSON.parse(text)) } catch { body = text }
    const captured = { status: response.status, headers: Object.fromEntries(response.headers), body }
    if (response.ok) record.finish(captured)
    else record.fail(new Error(`HTTP request rejected (${response.status})`), captured)
    return { response, text }
  } catch (error) {
    record.fail(error)
    throw error
  }
}

/** What a Draw Things CLI job was asked to run. */
export interface CliJobStart {
  jobId: string
  kind: string
  target: string
  cliPath: string
  args: readonly string[]
}

/** How a CLI job ended, and everything it wrote. */
export interface CliJobEnd {
  startedAt: string | null
  status: string
  exitCode: number | null
  signal: string | null
  stdout?: string
  stderr?: string
  // The error the process runner reported, such as a failed spawn; undefined when none.
  error?: unknown
}

export interface CliJobRecord {
  append(kind: 'stdout' | 'stderr', text: string, resume: () => void): boolean
  finish(end: CliJobEnd): void
}

/** Starts one CLI job's record when the job is asked for; the record is written
 *  once, when the job first finishes. */
export function startCliJobRecord(job: CliJobStart): CliJobRecord {
  const root = outputRoot
  const destination = worker
  const requested = new Date()
  const uuid = `${utcStampForFilename(requested)}-${randomUUID()}`
  const reportOutputFailure = (stream: 'stdout' | 'stderr') => (error: unknown): void => {
    writeLogRecord(new Date().toISOString(), 'warn', 'CLI output could not be retained', { jobId: job.jobId, stream, error: serializeError(error) })
  }
  const stdout = createCliOutputWriter(root, `${uuid}-stdout.log`, 'stdout', () => [...diagnosticCredentials], reportOutputFailure('stdout'))
  const stderr = createCliOutputWriter(root, `${uuid}-stderr.log`, 'stderr', () => [...diagnosticCredentials], reportOutputFailure('stderr'))
  const base = maskDiagnostic({
    time: requested.toISOString(), launch, session_id: activeSessionId,
    job_id: job.jobId, job_kind: job.kind, target: job.target, cli_path: job.cliPath, args: json(maskDiagnostic(job.args)),
  }) as Row
  let written = false
  let appended = false
  return {
    append: (kind, text, resume) => {
      if (written) return true
      appended = true
      return (kind === 'stdout' ? stdout : stderr).append(text, resume)
    },
    finish: (end) => {
      if (written) return
      written = true
      const endedAt = new Date().toISOString()
      const store = (): void => {
        const outputErrors = [stdout.error, stderr.error].filter((error) => error !== undefined).map(serializeError)
        write('cli_jobs', {
          ...base, started_at: end.startedAt, ended_at: endedAt, status: end.status,
          exit_code: end.exitCode, signal: end.signal,
          stdout: appended ? '' : maskDiagnostic(end.stdout ?? '') as string,
          stderr: appended ? '' : maskDiagnostic(end.stderr ?? '') as string,
          stdout_file: stdout.file, stderr_file: stderr.file,
          output_error: outputErrors.length ? json(maskDiagnostic(outputErrors)) : null,
          error: end.error === undefined ? null : json(maskDiagnostic(serializeError(end.error))),
        }, destination)
      }
      // Direct callers with legacy inline diagnostics remain compatible. Main
      // jobs append as they run and never retain an entire process's output.
      if (!appended) { store(); return }
      const finishing = Promise.all([stdout.finish(), stderr.finish()]).then(store)
      finishingOutputs.add(finishing)
      void finishing.finally(() => finishingOutputs.delete(finishing))
    },
  }
}
