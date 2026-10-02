import { serializeError } from '../shared/serialize-error'
import { writeLogRecord } from './records'

// Re-exported so main-process modules can keep importing serializeError from the
// logger alongside log(); the single implementation lives in shared/ so the
// renderer produces identical structured errors when forwarding over IPC.
export { serializeError }

// The app's logging, per the logging-conventions: the caller describes what
// happened as a stable message plus structured fields, and each line becomes a
// record (records.ts). Free of any electron import so it stays unit-testable
// under plain Node.

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

// Debug is off by default; the process startup policy flips it on for a
// development build or an explicit packaged-build diagnostic run.
let debugEnabled = false

// Enables or disables debug output for the whole process. Called once at
// startup using shouldEnableDebugLogging().
export function setLoggerDebug(enabled: boolean): void {
  debugEnabled = enabled
}

// The envelope keys the logger owns; a caller field may not overwrite them.
const RESERVED_KEYS: ReadonlySet<string> = new Set(['time', 'level', 'message'])

// Writes one log record. debug lines are written only when debug is enabled.
// Logging never throws: records.ts keeps a line it cannot store in the
// launch's plain text file or on the console.
export function log(level: LogLevel, message: string, fields?: LogFields): void {
  if (level === 'debug' && !debugEnabled) return
  const kept: LogFields = {}
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (!RESERVED_KEYS.has(key)) kept[key] = value
  }
  writeLogRecord(new Date().toISOString(), level, message, kept)
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
  baseName: string | null
): void {
  log('debug', 'Generation complete', { taskId, durationMs, baseName })
}

export function logGenerationFailed(taskId: string, err: unknown, context?: Record<string, unknown>): void {
  log('error', 'Generation failed', { taskId, error: serializeError(err), ...context })
}
