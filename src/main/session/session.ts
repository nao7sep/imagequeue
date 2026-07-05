import fs from 'fs'
import path from 'path'
import { getDataDir } from '../config'

// Formats a Date as yyyymmdd-hhmmss in UTC. Second precision: used for the per-image output
// timestamp allocator, which paces uniqueness with its own same-second ordinal, not milliseconds.
export function formatTimestamp(date: Date): string {
  const y = date.getUTCFullYear()
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const h = String(date.getUTCHours()).padStart(2, '0')
  const mi = String(date.getUTCMinutes()).padStart(2, '0')
  const s = String(date.getUTCSeconds()).padStart(2, '0')
  return `${y}${mo}${d}-${h}${mi}${s}`
}

// Formats a Date as yyyymmdd-hhmmss-fff in UTC (millisecond precision), extending formatTimestamp
// with the fractional-second part. Used for the session directory name — a machine-paced name per
// the timestamp-conventions, like a session log or a backup archive.
export function formatTimestampMs(date: Date): string {
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0')
  return `${formatTimestamp(date)}-${ms}`
}

let sessionDir: string | null = null

export function getOutputDir(): string {
  const outputDir = path.join(getDataDir(), 'output')
  fs.mkdirSync(outputDir, { recursive: true })
  return outputDir
}

export function createSessionDir(baseDate = new Date()): string {
  let candidate = new Date(baseDate)
  while (true) {
    const nextDir = path.join(getOutputDir(), `${formatTimestampMs(candidate)}-utc`)
    if (!fs.existsSync(nextDir)) {
      fs.mkdirSync(nextDir, { recursive: true })
      return nextDir
    }
    candidate = new Date(candidate.getTime() + 1000)
  }
}

// Creates the session output directory on app launch. Called once.
export function initSession(): string {
  sessionDir = createSessionDir()
  return sessionDir
}

export function getSessionDir(): string {
  if (!sessionDir) {
    throw new Error('Session not initialized. Call initSession() first.')
  }
  return sessionDir
}

export function setSessionDir(nextSessionDir: string): string {
  fs.mkdirSync(nextSessionDir, { recursive: true })
  sessionDir = nextSessionDir
  return sessionDir
}

export function getSessionId(): string {
  return path.basename(getSessionDir())
}
