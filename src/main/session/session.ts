import fs from 'fs'
import path from 'path'
import { getDataDir } from '../config'
import { utcStampForFilename } from '../../shared/utc-stamp'
import { setRecordsSession } from '../records'


let sessionDir: string | null = null

// Sessions are transient app-owned work (storage-path-conventions), so their
// folder is named for what it holds rather than as output the user keeps.
export function getSessionsDir(): string {
  const sessionsDir = path.join(getDataDir(), 'sessions')
  fs.mkdirSync(sessionsDir, { recursive: true })
  return sessionsDir
}

// Sessions lived in output/ until the folder was renamed. A data root that has
// only that folder has it renamed once, before anything reads the sessions; a
// rename that fails stops launch rather than start with an empty list beside
// the old sessions.
function renameOutputFolder(): void {
  const root = getDataDir()
  const sessionsDir = path.join(root, 'sessions')
  const outputDir = path.join(root, 'output')
  if (fs.existsSync(sessionsDir) || !fs.existsSync(outputDir)) return
  fs.renameSync(outputDir, sessionsDir)
}

export function createSessionDir(baseDate = new Date()): string {
  let candidate = new Date(baseDate)
  while (true) {
    const nextDir = path.join(getSessionsDir(), utcStampForFilename(candidate))
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

// Creates the session directory on app launch. Called once.
export function initSession(): string {
  renameOutputFolder()
  sessionDir = createSessionDir()
  setRecordsSession(path.basename(sessionDir))
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
  setRecordsSession(path.basename(sessionDir))
  return sessionDir
}

export function getSessionId(): string {
  return path.basename(getSessionDir())
}
