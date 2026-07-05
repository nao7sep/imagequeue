import fs from 'fs'
import path from 'path'
import { serializeError } from '../shared/serialize-error'

// Re-exported so main-process modules can keep importing serializeError from the
// logger alongside log(); the single implementation lives in shared/ so the
// renderer produces identical structured errors when forwarding over IPC.
export { serializeError }

// A small, hand-rolled, dependency-free logger that writes one JSON object per
// line (JSON Lines) to the active session's session.log. It is deliberately
// free of any electron import so it stays unit-testable under plain Node (see
// vitest.config.ts) and so the file-IO edge here carries no app logic.
//
// The caller describes *what happened* as a stable message plus structured
// fields; this module builds the envelope, redacts denied keys, serializes, and
// appends. Writes are synchronous, so every line is durable the moment it is
// logged — there is no buffer to lose on a crash, which satisfies the
// "flush warn/error/debug immediately and on crash" requirement for free.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type LogFields = Record<string, unknown>

// Single source of truth for the startup debug gate. Development builds write
// debug logs automatically; packaged builds stay quiet unless deliberately
// launched with IMAGEQUEUE_DEBUG=1 for diagnostics.
export function shouldEnableDebugLogging({
  isPackaged,
  imagequeueDebug,
}: {
  isPackaged: boolean
  imagequeueDebug?: string
}): boolean {
  return !isPackaged || imagequeueDebug === '1'
}

let logFilePath: string | null = null

// Debug is off by default; the process startup policy flips it on for a
// development build or an explicit packaged-build diagnostic run.
let debugEnabled = false

const REDACTED = '[redacted]'

// Field names whose VALUES are replaced before serialization. Matched by exact,
// case-insensitive name — never by substring, so `token` never matches
// `tokenCount`. Both camelCase and snake_case spellings are listed because the
// match is exact: this app stores keys as `api_key`. Seeded with the obvious
// secrets and extended as needed (no cross-app taxonomy).
const DENIED_KEYS: ReadonlySet<string> = new Set(
  ['apiKey', 'api_key', 'authorization', 'token', 'password', 'secret', 'x-key', 'x-api-key'].map(
    (key) => key.toLowerCase()
  )
)

// Enables or disables debug output for the whole process. Called once at
// startup using shouldEnableDebugLogging().
export function setLoggerDebug(enabled: boolean): void {
  debugEnabled = enabled
}

function setLogSessionDir(sessionDir: string): void {
  logFilePath = path.join(sessionDir, 'session.log')
}

// Points the logger at a session directory's session.log and records the
// session start. The per-session directory + fixed session.log name is the
// logging-convention's explicitly allowed alternative to a <utc>.log file.
export function initLogger(sessionDir: string): void {
  setLogSessionDir(sessionDir)
  log('info', 'Session started', { sessionDir })
}

// Repoints the logger when the user resumes a different session.
export function retargetLogger(sessionDir: string): void {
  setLogSessionDir(sessionDir)
  log('info', 'Session resumed', { sessionDir })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

// Non-destructive, type-preserving redactor. Rebuilds only plain objects and
// arrays, replacing the value of a denied key with a fixed marker and leaving
// every other value byte-identical. It never inspects string contents and never
// edits the message. Non-plain objects (Date, Buffer, Map, Set, class
// instances) pass through untouched — JSON.stringify renders them correctly
// (e.g. a Date to an ISO string), whereas iterating them via Object.entries
// would flatten them to `{}` and destroy data. It is total: a true reference
// cycle (unrepresentable in JSON) is collapsed to a marker rather than
// overflowing the stack, while a value merely shared between sibling fields is
// still fully processed in each place — so legitimate fields are never dropped.
function redactInner(value: unknown, ancestors: Set<object>): unknown {
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return '[circular]'
    ancestors.add(value)
    const result = value.map((item) => redactInner(item, ancestors))
    ancestors.delete(value)
    return result
  }
  if (isPlainObject(value)) {
    if (ancestors.has(value)) return '[circular]'
    ancestors.add(value)
    const out: Record<string, unknown> = {}
    for (const [key, fieldValue] of Object.entries(value)) {
      out[key] = DENIED_KEYS.has(key.toLowerCase()) ? REDACTED : redactInner(fieldValue, ancestors)
    }
    ancestors.delete(value)
    return out
  }
  return value
}

export function redact(value: unknown): unknown {
  return redactInner(value, new Set<object>())
}

// The envelope keys the logger owns; a caller field may not overwrite them.
const RESERVED_KEYS: ReadonlySet<string> = new Set(['time', 'level', 'message'])

// Best-effort console fallback shared by both "no session target yet" and
// "write to the session file failed" below. Mirrors the fotoready/bigmouth
// loggers' fallback split: warn/error go to stderr, info/debug to stdout. The
// argument is the already-rendered JSON line, never a re-derived summary, so
// the event's actual content — not just a generic notice that something was
// dropped — reaches the console.
function consoleFallback(level: LogLevel, line: string): void {
  const sink = level === 'error' || level === 'warn' ? console.error : console.log
  sink(line.trimEnd())
}

// Appends one JSON Lines event to the active session log. Takes a structured
// event — a short, stable message plus arbitrary fields — and builds the
// envelope { time, level, message, ...redactedFields }. debug lines are written
// only when debug is enabled. Logging never throws and never crashes the app: a
// field that cannot be serialized falls back to a minimal envelope, and both a
// missing session target and a failed write degrade to the console
// (best-effort, no new dependencies) rather than dropping the event.
export function log(level: LogLevel, message: string, fields?: LogFields): void {
  if (level === 'debug' && !debugEnabled) return

  const time = new Date().toISOString()
  const entry: Record<string, unknown> = { time, level, message }
  if (fields) {
    const redacted = redact(fields) as Record<string, unknown>
    for (const key of Object.keys(redacted)) {
      // Envelope keys are reserved: a caller field named time/level/message
      // cannot overwrite them and corrupt the line's schema.
      if (RESERVED_KEYS.has(key)) continue
      entry[key] = redacted[key]
    }
  }

  let line: string
  try {
    line = JSON.stringify(entry) + '\n'
  } catch {
    // A field was not serializable (e.g. a BigInt, or a getter that throws).
    // Never lose the event: fall back to the bare envelope. message/level/time
    // are all strings, so this stringify cannot itself throw.
    line = JSON.stringify({ time, level, message, logSerializeError: 'fields not serializable' }) + '\n'
  }

  if (!logFilePath) {
    // Nothing has pointed the logger at a session yet (a line logged before
    // initLogger/retargetLogger runs — e.g. while the storage root is still
    // being resolved during early startup). There is no buffer to append this
    // into and no session file to flush it to later, so — same as a write
    // failure below — echo the real rendered line to the console rather than
    // silently dropping the event.
    consoleFallback(level, line)
    return
  }

  try {
    fs.appendFileSync(logFilePath, line, 'utf-8')
  } catch (err) {
    // The log file may be unwritable (disk full, permissions). Degrade to the
    // console and keep running — never crash because logging failed, and never
    // let the event's actual content be lost behind a generic failure notice.
    console.error('[logger] failed to write log line; echoing to console instead', err)
    consoleFallback(level, line)
  }
}

export function logEnqueue(
  taskId: string,
  backend: string,
  model: string,
  prompt: string,
  params: Record<string, unknown>,
  count: number
): void {
  log('info', 'Task enqueued', { taskId, backend, model, prompt, params, count })
}

// Per-image lifecycle lines. These fire once per task — 2N per batch — so they
// are debug, not info: a developer running unpackaged sees the full per-image
// trace, while a packaged build stays silent. The queue's one info "Queue
// drained" summary (X ok / Y failed / duration) carries the production signal;
// individual failures still log at error via logGenerationFailed. This is the
// loops-aggregate rule: enumerate failures, count successes, don't log per item.
export function logGenerationStart(taskId: string, backend: string, model: string): void {
  log('debug', 'Generation started', { taskId, backend, model })
}

export function logGenerationComplete(
  taskId: string,
  durationMs: number,
  baseName: string | null,
  estimatedCostUsd: number | null
): void {
  log('debug', 'Generation complete', { taskId, durationMs, baseName, estimatedCostUsd })
}

export function logGenerationFailed(taskId: string, err: unknown, context?: Record<string, unknown>): void {
  log('error', 'Generation failed', { taskId, error: serializeError(err), ...context })
}

export function logApiRequest(backend: string, endpoint: string, params: Record<string, unknown>): void {
  log('debug', 'API request', { backend, endpoint, params })
}

export function logApiResponse(backend: string, status: number | string, durationMs?: number): void {
  log('debug', 'API response', { backend, status, durationMs })
}
