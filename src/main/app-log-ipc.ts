import { handle } from './ipc-boundary'
import { log, type LogLevel } from './logger'

const ALLOWED_LEVELS: ReadonlySet<LogLevel> = new Set<LogLevel>(['info', 'warn', 'error', 'debug'])

// Lets the renderer write entries to the active session.log. The renderer (a
// sandboxed process) never opens the log file itself; it forwards structured log
// objects here and the main process owns the file and runs redaction. Used for
// things the renderer knows but the main process doesn't (e.g. user clicked
// Queue with mode=fresh-task and 4 targets). Diagnostic-only — not a generic
// data channel: keep payloads small and structured.
export function registerAppLogIpc(): void {
  handle('app:log', (_event, level: string, message: string, data?: Record<string, unknown>) => {
    const safeLevel: LogLevel = ALLOWED_LEVELS.has(level as LogLevel) ? (level as LogLevel) : 'info'
    log(safeLevel, message, data)
  })
}
