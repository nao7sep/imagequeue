import fs from 'fs'
import path from 'path'

let logFilePath: string | null = null

// Initializes the logger to write to session.log in the given session directory.
export function initLogger(sessionDir: string): void {
  logFilePath = path.join(sessionDir, 'session.log')
  log('info', 'Session started')
}

type LogLevel = 'info' | 'warn' | 'error' | 'debug'

// Appends a timestamped line to the session log file.
export function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  if (!logFilePath) return

  const ts = new Date().toISOString()
  let line = `[${ts}] [${level.toUpperCase()}] ${message}`
  if (data) {
    line += ' ' + JSON.stringify(data)
  }
  line += '\n'

  try {
    fs.appendFileSync(logFilePath, line, 'utf-8')
  } catch {
    // Logging must never crash the app.
  }
}

export function logEnqueue(taskId: string, backend: string, model: string, params: Record<string, unknown>): void {
  log('info', `Enqueued task ${taskId}`, { backend, model, params })
}

export function logGenerationStart(taskId: string, backend: string, model: string): void {
  log('info', `Generation started: ${taskId}`, { backend, model })
}

export function logGenerationComplete(taskId: string, durationMs: number): void {
  log('info', `Generation complete: ${taskId}`, { durationMs })
}

export function logGenerationFailed(taskId: string, error: string): void {
  log('error', `Generation failed: ${taskId}`, { error })
}

export function logApiRequest(backend: string, endpoint: string, params: Record<string, unknown>): void {
  log('debug', `API request: ${backend}`, { endpoint, params })
}

export function logApiResponse(backend: string, status: number | string, durationMs?: number): void {
  log('debug', `API response: ${backend}`, { status, durationMs })
}
