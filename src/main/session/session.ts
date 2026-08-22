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
    try {
      // The mkdir itself is the claim. An exists-then-recursive-mkdir sequence
      // lets two simultaneous launches both adopt the same session directory
      // and overwrite each other's manifest. A non-recursive mkdir is atomic;
      // the loser advances to the next millisecond-derived name.
      fs.mkdirSync(nextDir)
      return nextDir
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
    candidate = new Date(candidate.getTime() + 1)
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
