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
  return sessionsDir
}

// Sessions lived in output/ until the folder was renamed. A data root that has
// only that folder has it renamed once, before anything reads the sessions; a
// rename that fails stops launch rather than start with an empty list beside
// the old sessions.
async function renameOutputFolder(): Promise<void> {
  const root = getDataDir()
  const sessionsDir = path.join(root, 'sessions')
  const outputDir = path.join(root, 'output')
  const exists = async (file: string): Promise<boolean> => fs.promises.stat(file).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return false; throw error })
  if (await exists(sessionsDir) || !await exists(outputDir)) return
  await fs.promises.rename(outputDir, sessionsDir)
}

// A session is named for the second it started. The single-instance lock and
// the session-operation guard leave one creator, so the mkdir is the claim: a
// name already taken in that second fails rather than adopt or overwrite it.
export async function createSessionDir(date = new Date()): Promise<string> {
  const nextDir = path.join(getSessionsDir(), utcStampForFilename(date))
  await fs.promises.mkdir(getSessionsDir(), { recursive: true })
  await fs.promises.mkdir(nextDir)
  return nextDir
}

// Creates the session directory on app launch. Called once.
export async function initSession(): Promise<string> {
  await renameOutputFolder()
  sessionDir = await createSessionDir()
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
  sessionDir = nextSessionDir
  setRecordsSession(path.basename(sessionDir))
  return sessionDir
}

export function getSessionId(): string {
  return path.basename(getSessionDir())
}
