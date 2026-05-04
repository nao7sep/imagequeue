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
  Task,
} from '../../shared/types'
import { log, retargetLogger } from '../logger'
import { queueManager } from '../queue/queue-manager'
import { getOutputDir, getSessionDir, getSessionId, setSessionDir } from './session'

const SESSION_MANIFEST_FILENAME = 'session.json'

function createEmptyQueues(): Record<BackendId, Task[]> {
  return {
    openai: [],
    imagen: [],
    nanobanana: [],
    grok: [],
    flux: [],
    drawthings: [],
  }
}

function cloneTask(task: Task): Task {
  return {
    ...task,
    params: { ...task.params },
  }
}

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
    return {
      ...parsed,
      tasks: cloneQueues(parsed.tasks),
    }
  } catch (error) {
    log('warn', 'Ignoring unreadable session manifest', {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
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
  if (task.status === 'completed') return cloneTask(task)
  return {
    ...cloneTask(task),
    status: 'interrupted',
    startedAt: null,
    completedAt: null,
    durationMs: null,
    imagePath: null,
    thumbnailPath: null,
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

function broadcastQueueUpdate(tasksByBackend: Record<BackendId, Task[]>): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('queue:updated', tasksByBackend)
  }
}

export function resolveSessionDir(sessionId: string): string {
  const safeSessionId = ensureSessionId(sessionId)
  return path.join(getOutputDir(), safeSessionId)
}

export function persistActiveSession(options?: { lastResumedAt?: string | null }): SessionManifest {
  const sessionDir = getSessionDir()
  fs.mkdirSync(sessionDir, { recursive: true })
  const previous = readManifestFromDir(sessionDir)
  const manifest = buildManifest(getSessionId(), queueManager.getAllTasks(), previous, options)
  writeManifestFile(getManifestPath(sessionDir), manifest)
  return manifest
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
    summaries.push({
      sessionId: manifest.sessionId,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      lastResumedAt: manifest.lastResumedAt,
      taskCounts: manifest.taskCounts,
      isCurrent: manifest.sessionId === currentSessionId,
    })
  }

  return summaries.sort((a, b) => {
    const updatedDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    if (updatedDiff !== 0) return updatedDiff
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
}

export function resumeSession(sessionId: string): void {
  if (sessionId === getSessionId()) return
  if (queueManager.hasGeneratingTasks()) {
    throw new Error('Wait for active generation to finish before resuming another session.')
  }

  const sessionDir = resolveSessionDir(sessionId)
  const manifest = readManifestFromDir(sessionDir)
  if (!manifest) {
    throw new Error('That session is missing its session.json file.')
  }

  const resumedQueues = normalizeResumedQueues(manifest.tasks)
  setSessionDir(sessionDir)
  retargetLogger(sessionDir)
  queueManager.replaceAllTasks(resumedQueues)
  persistActiveSession({ lastResumedAt: new Date().toISOString() })
  broadcastQueueUpdate(queueManager.getAllTasks())
}

export async function deleteSession(sessionId: string): Promise<void> {
  if (sessionId === getSessionId()) {
    throw new Error('The current session cannot be deleted while it is open.')
  }

  const sessionDir = resolveSessionDir(sessionId)
  if (!fs.existsSync(sessionDir)) {
    throw new Error('That session folder no longer exists.')
  }

  await shell.trashItem(sessionDir)
}
