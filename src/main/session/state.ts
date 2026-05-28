import fs from 'fs'
import path from 'path'
import { BrowserWindow, shell } from 'electron'
import {
  BACKEND_IDS_IN_UI_ORDER,
  BackendId,
  SESSION_MANIFEST_VERSION,
  SessionManifest,
  SessionSummary,
  SessionTaskCounts,
  SessionThumbnail,
  Task,
} from '../../shared/types'
import { loadConfig } from '../config'
import { initLogger, log, retargetLogger } from '../logger'
import { shouldDeleteToTrash, shouldDropEmptySessions } from '../../shared/config'
import { cloneTask, createEmptyQueues, normalizeTaskRecord, queueManager } from '../queue/queue-manager'
import { createSessionDir, getOutputDir, getSessionDir, getSessionId, setSessionDir } from './session'
import { resetOutputTimestampAllocators, seedOutputTimestampAllocators } from './output-timestamps'

const SESSION_MANIFEST_FILENAME = 'session.json'
let currentElaboratedPrompts: string[] = []
let currentElaboratedPromptsLoaded = false

function cloneQueues(tasksByBackend: Record<BackendId, Task[]>): Record<BackendId, Task[]> {
  const cloned = createEmptyQueues()
  for (const backend of BACKEND_IDS_IN_UI_ORDER) {
    cloned[backend] = (tasksByBackend[backend] ?? []).map(cloneTask)
  }
  return cloned
}

function createTaskCounts(tasksByBackend: Record<BackendId, Task[]>): SessionTaskCounts {
  const counts: SessionTaskCounts = {
    total: 0,
    queued: 0,
    generating: 0,
    completed: 0,
    kept: 0,
    failed: 0,
    interrupted: 0,
  }

  for (const backend of BACKEND_IDS_IN_UI_ORDER) {
    for (const task of tasksByBackend[backend] ?? []) {
      counts.total++
      counts[task.status]++
    }
  }

  return counts
}

function collectTasks(tasksByBackend: Record<BackendId, Task[]>): Task[] {
  return BACKEND_IDS_IN_UI_ORDER.flatMap((backend) => tasksByBackend[backend] ?? [])
}

function createSessionDisplayCounts(tasksByBackend: Record<BackendId, Task[]>): {
  completedCount: number
  retryCount: number
  keptCount: number
} {
  const allTasks = collectTasks(tasksByBackend)

  return {
    completedCount: allTasks.filter((task) => task.status === 'completed').length,
    retryCount: allTasks.filter((task) => task.status === 'failed' || task.status === 'interrupted').length,
    keptCount: allTasks.filter((task) => task.status === 'kept').length,
  }
}

function collectSessionThumbnails(tasksByBackend: Record<BackendId, Task[]>, limit = 3): SessionThumbnail[] {
  const completedTasks = collectTasks(tasksByBackend)
    .filter((task) =>
      task.status === 'completed' &&
      task.baseName
    )
    .sort((a, b) => {
      const aTime = new Date(a.completedAt ?? a.enqueuedAt).getTime()
      const bTime = new Date(b.completedAt ?? b.enqueuedAt).getTime()
      return bTime - aTime
    })

  return completedTasks.slice(0, limit).map((task) => ({ baseName: task.baseName! }))
}

function getManifestPath(sessionDir = getSessionDir()): string {
  return path.join(sessionDir, SESSION_MANIFEST_FILENAME)
}

function writeManifestFile(filePath: string, manifest: SessionManifest): void {
  const tempPath = `${filePath}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(manifest, null, 2), 'utf-8')
  fs.renameSync(tempPath, filePath)
}

function isSessionManifest(value: unknown): value is SessionManifest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SessionManifest>
  if (candidate.version !== SESSION_MANIFEST_VERSION) return false
  if (typeof candidate.sessionId !== 'string') return false
  if (typeof candidate.createdAt !== 'string') return false
  if (typeof candidate.updatedAt !== 'string') return false
  if (!(candidate.lastResumedAt === null || typeof candidate.lastResumedAt === 'string')) return false
  if (!Array.isArray(candidate.elaboratedPrompts)) return false
  if (!candidate.elaboratedPrompts.every((prompt) => typeof prompt === 'string')) return false
  if (!candidate.taskCounts || typeof candidate.taskCounts !== 'object') return false
  if (!candidate.tasks || typeof candidate.tasks !== 'object') return false
  return BACKEND_IDS_IN_UI_ORDER.every((backend) => Array.isArray(candidate.tasks?.[backend]))
}

function readManifestFromDir(sessionDir: string): SessionManifest | null {
  const filePath = getManifestPath(sessionDir)
  if (!fs.existsSync(filePath)) return null

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown
    if (!isSessionManifest(parsed)) {
      throw new Error('Invalid session manifest shape')
    }
    const normalizedTasks = createEmptyQueues()
    for (const backend of BACKEND_IDS_IN_UI_ORDER) {
      normalizedTasks[backend] = parsed.tasks[backend].map(normalizeTaskRecord)
    }
    return {
      ...parsed,
      elaboratedPrompts: [...parsed.elaboratedPrompts],
      tasks: normalizedTasks,
    }
  } catch (error) {
    log('warn', 'Ignoring unreadable session manifest', {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function ensureActiveElaboratedPromptsLoaded(): void {
  if (currentElaboratedPromptsLoaded) return
  const manifest = readManifestFromDir(getSessionDir())
  currentElaboratedPrompts = manifest?.elaboratedPrompts ? [...manifest.elaboratedPrompts] : []
  currentElaboratedPromptsLoaded = true
}

function buildManifest(
  sessionId: string,
  tasksByBackend: Record<BackendId, Task[]>,
  previous: SessionManifest | null,
  options?: { lastResumedAt?: string | null }
): SessionManifest {
  return {
    version: SESSION_MANIFEST_VERSION,
    sessionId,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastResumedAt: options?.lastResumedAt ?? previous?.lastResumedAt ?? null,
    taskCounts: createTaskCounts(tasksByBackend),
    elaboratedPrompts: [...currentElaboratedPrompts],
    tasks: cloneQueues(tasksByBackend),
  }
}

function ensureSessionId(sessionId: string): string {
  if (!sessionId || path.basename(sessionId) !== sessionId) {
    throw new Error('Invalid session id.')
  }
  return sessionId
}

function toInterruptedTask(task: Task): Task {
  if (task.status === 'completed' || task.status === 'kept') return cloneTask(task)
  return {
    ...cloneTask(task),
    status: 'interrupted',
    startedAt: null,
    completedAt: null,
    durationMs: null,
    imagePath: null,
    baseName: null,
    error: null,
  }
}

function normalizeResumedQueues(tasksByBackend: Record<BackendId, Task[]>): Record<BackendId, Task[]> {
  const normalized = createEmptyQueues()
  for (const backend of BACKEND_IDS_IN_UI_ORDER) {
    normalized[backend] = (tasksByBackend[backend] ?? []).map(toInterruptedTask)
  }
  return normalized
}

// A session has user value if any task exists in any backend, regardless of
// status. Elaborated prompts deliberately do not count: they exist only to
// steer future elaborations and are discarded with the session.
export function sessionHasUserValue(tasksByBackend: Record<BackendId, Task[]>): boolean {
  return collectTasks(tasksByBackend).length > 0
}

// Drops a session directory, honoring delete_to_trash. Used by the three
// auto-drop paths (new session, resume session, quit) when the setting is on
// and the session is empty.
async function dropSession(sessionDir: string, sessionId: string, reason: string): Promise<void> {
  if (!fs.existsSync(sessionDir)) return
  const toTrash = shouldDeleteToTrash(loadConfig().general.delete_to_trash)
  if (toTrash) {
    await shell.trashItem(sessionDir)
  } else {
    fs.rmSync(sessionDir, { recursive: true, force: true })
  }
  log('info', `Dropped empty session (${reason})`, { sessionId, path: sessionDir, toTrash })
}

function shouldAutoDropSession(tasksByBackend: Record<BackendId, Task[]>): boolean {
  if (!shouldDropEmptySessions(loadConfig().general.drop_empty_sessions)) return false
  return !sessionHasUserValue(tasksByBackend)
}

export async function dropCurrentSessionIfEmpty(reason: string): Promise<boolean> {
  if (!shouldAutoDropSession(queueManager.getAllStoredTasks())) return false
  await dropSession(getSessionDir(), getSessionId(), reason)
  return true
}

function broadcastQueueUpdate(tasksByBackend: Record<BackendId, Task[]>): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('queue:updated', tasksByBackend)
  }
}

// Fired whenever the active session changes (new session, resume into another).
// Renderer-side session-scoped contexts (e.g. AdvancedPromptingContext) listen
// to this to reset their in-memory state.
function broadcastSessionChanged(sessionId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('session:changed', { sessionId })
  }
}

export function resolveSessionDir(sessionId: string): string {
  const safeSessionId = ensureSessionId(sessionId)
  return path.join(getOutputDir(), safeSessionId)
}

export function persistActiveSession(options?: { lastResumedAt?: string | null }): SessionManifest {
  ensureActiveElaboratedPromptsLoaded()
  const sessionDir = getSessionDir()
  fs.mkdirSync(sessionDir, { recursive: true })
  const previous = readManifestFromDir(sessionDir)
  const manifest = buildManifest(getSessionId(), queueManager.getAllStoredTasks(), previous, options)
  writeManifestFile(getManifestPath(sessionDir), manifest)
  return manifest
}

export async function createSession(): Promise<void> {
  if (queueManager.hasGeneratingTasks()) {
    throw new Error('Wait for active generation to finish before starting a new session.')
  }

  const previousSessionDir = getSessionDir()
  const previousSessionId = getSessionId()
  const dropPrevious = shouldAutoDropSession(queueManager.getAllStoredTasks())

  if (!dropPrevious) persistActiveSession()

  const sessionDir = createSessionDir()
  setSessionDir(sessionDir)
  initLogger(sessionDir)
  queueManager.replaceAllTasks(createEmptyQueues())
  resetOutputTimestampAllocators()
  currentElaboratedPrompts = []
  currentElaboratedPromptsLoaded = true
  persistActiveSession()
  broadcastQueueUpdate(queueManager.getAllStoredTasks())
  broadcastSessionChanged(getSessionId())

  if (dropPrevious) {
    await dropSession(previousSessionDir, previousSessionId, 'new-session')
  }
}

export function listSessions(): SessionSummary[] {
  const outputDir = getOutputDir()
  const currentSessionId = getSessionId()
  const entries = fs.readdirSync(outputDir, { withFileTypes: true })
  const summaries: SessionSummary[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const manifest = readManifestFromDir(path.join(outputDir, entry.name))
    if (!manifest) continue
    const displayCounts = createSessionDisplayCounts(manifest.tasks)
    summaries.push({
      sessionId: manifest.sessionId,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      lastResumedAt: manifest.lastResumedAt,
      taskCounts: manifest.taskCounts,
      completedCount: displayCounts.completedCount,
      retryCount: displayCounts.retryCount,
      keptCount: displayCounts.keptCount,
      thumbnails: collectSessionThumbnails(manifest.tasks),
      isCurrent: manifest.sessionId === currentSessionId,
    })
  }

  return summaries.sort((a, b) => {
    const updatedDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    if (updatedDiff !== 0) return updatedDiff
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
}

export async function resumeSession(sessionId: string): Promise<void> {
  if (sessionId === getSessionId()) return
  if (queueManager.hasGeneratingTasks()) {
    throw new Error('Wait for active generation to finish before resuming another session.')
  }

  const previousSessionDir = getSessionDir()
  const previousSessionId = getSessionId()
  const dropPrevious = shouldAutoDropSession(queueManager.getAllStoredTasks())

  const sessionDir = resolveSessionDir(sessionId)
  const manifest = readManifestFromDir(sessionDir)
  if (!manifest) {
    throw new Error('That session is missing a readable session.json file.')
  }

  const resumedQueues = normalizeResumedQueues(manifest.tasks)
  setSessionDir(sessionDir)
  retargetLogger(sessionDir)
  queueManager.replaceAllTasks(resumedQueues)
  resetOutputTimestampAllocators()
  seedOutputTimestampAllocators(manifest.tasks)
  currentElaboratedPrompts = [...manifest.elaboratedPrompts]
  currentElaboratedPromptsLoaded = true
  persistActiveSession({ lastResumedAt: new Date().toISOString() })
  broadcastQueueUpdate(queueManager.getAllStoredTasks())
  broadcastSessionChanged(getSessionId())

  if (dropPrevious && previousSessionId !== sessionId) {
    await dropSession(previousSessionDir, previousSessionId, 'resume')
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  if (sessionId === getSessionId()) {
    throw new Error('The current session cannot be deleted while it is open.')
  }

  const sessionDir = resolveSessionDir(sessionId)
  if (!fs.existsSync(sessionDir)) {
    throw new Error('That session folder no longer exists.')
  }

  const toTrash = shouldDeleteToTrash(loadConfig().general.delete_to_trash)
  if (toTrash) {
    await shell.trashItem(sessionDir)
  } else {
    fs.rmSync(sessionDir, { recursive: true, force: true })
  }
}

export function getActiveSessionElaboratedPrompts(): string[] {
  ensureActiveElaboratedPromptsLoaded()
  return [...currentElaboratedPrompts]
}

export function appendActiveSessionElaboratedPrompts(prompts: string[]): string[] {
  if (prompts.length === 0) return getActiveSessionElaboratedPrompts()
  ensureActiveElaboratedPromptsLoaded()
  currentElaboratedPrompts = [...currentElaboratedPrompts, ...prompts]
  persistActiveSession()
  return [...currentElaboratedPrompts]
}

export function deleteActiveSessionElaboratedPromptAt(index: number): string[] {
  ensureActiveElaboratedPromptsLoaded()
  if (index < 0 || index >= currentElaboratedPrompts.length) return [...currentElaboratedPrompts]
  currentElaboratedPrompts = currentElaboratedPrompts.filter((_, promptIndex) => promptIndex !== index)
  persistActiveSession()
  return [...currentElaboratedPrompts]
}

export function clearActiveSessionElaboratedPrompts(): string[] {
  ensureActiveElaboratedPromptsLoaded()
  currentElaboratedPrompts = []
  persistActiveSession()
  return []
}
