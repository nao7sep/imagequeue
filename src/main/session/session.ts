import fs from 'fs'
import path from 'path'
import { getDataDir } from '../config'
import { utcStampForFilename } from '../../shared/utc-stamp'


let sessionDir: string | null = null

export function getOutputDir(): string {
  const outputDir = path.join(getDataDir(), 'output')
  fs.mkdirSync(outputDir, { recursive: true })
  return outputDir
}

export function createSessionDir(baseDate = new Date()): string {
  let candidate = new Date(baseDate)
  while (true) {
    const nextDir = path.join(getOutputDir(), utcStampForFilename(candidate))
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
