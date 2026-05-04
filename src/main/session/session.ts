import fs from 'fs'
import path from 'path'
import { getDataDir } from '../config'

// Formats a Date as yyyymmdd-hhmmss in UTC.
export function formatTimestamp(date: Date): string {
  const y = date.getUTCFullYear()
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const h = String(date.getUTCHours()).padStart(2, '0')
  const mi = String(date.getUTCMinutes()).padStart(2, '0')
  const s = String(date.getUTCSeconds()).padStart(2, '0')
  return `${y}${mo}${d}-${h}${mi}${s}`
}

let sessionDir: string | null = null

export function getOutputDir(): string {
  const outputDir = path.join(getDataDir(), 'output')
  fs.mkdirSync(outputDir, { recursive: true })
  return outputDir
}

// Creates the session output directory on app launch. Called once.
export function initSession(): string {
  const timestamp = formatTimestamp(new Date())
  sessionDir = path.join(getOutputDir(), `${timestamp}-utc`)
  fs.mkdirSync(sessionDir, { recursive: true })

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
