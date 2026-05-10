import { ipcMain } from 'electron'
import { log } from './logger'

type Level = 'info' | 'warn' | 'error' | 'debug'

const ALLOWED_LEVELS: ReadonlySet<Level> = new Set(['info', 'warn', 'error', 'debug'])

// Lets the renderer write entries to the active session.log. Used for things
// the renderer knows but the main process doesn't (e.g. user clicked Queue
// with mode=fresh-task and 4 targets). Diagnostic-only — not a generic data
// channel: keep payloads small and structured.
export function registerAppLogIpc(): void {
  ipcMain.handle('app:log', (_event, level: string, message: string, data?: Record<string, unknown>) => {
    const safeLevel: Level = ALLOWED_LEVELS.has(level as Level) ? (level as Level) : 'info'
    log(safeLevel, message, data)
  })
}
