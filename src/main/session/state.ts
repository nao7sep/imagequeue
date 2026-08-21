import fs from 'fs'
import path from 'path'
import { BrowserWindow, shell } from 'electron'
import {
  ConceptCredit,
  ElaboratedPromptRecord,
  BACKEND_IDS_IN_UI_ORDER,
  BackendId,
  SESSION_MANIFEST_VERSION,
  SessionManifest,
  SessionSummary,
  SessionTaskCounts,
  SessionThumbnail,
  Task,
} from '../../shared/types'
import { createEmptySessionDraft, normalizeSessionDraft, type SessionDraft } from '../../shared/session-draft'
import { loadConfig } from '../config'
import { log, serializeError } from '../logger'
import { shouldDeleteToTrash, shouldDropEmptySessions } from '../../shared/config'
import { cloneTask, createEmptyQueues, normalizeTaskRecord, queueManager } from '../queue/queue-manager'
import { createSessionDir, getOutputDir, getSessionDir, getSessionId, setSessionDir } from './session'
import { resetOutputTimestampAllocators, seedOutputTimestampAllocators } from './output-timestamps'
import { writeJsonAtomic } from '../utils/atomic-write'
import { createCoalescedWriter } from '../utils/coalesced-writer'
import { publishQueueState } from '../queue/publisher'

const SESSION_MANIFEST_FILENAME = 'session.json'

// Single source of truth for the active session's renderer-facing manifest
// fields: the prompt/elaboration working state plus the timestamps we stamp on
// each write. null until loaded; replaced as a whole unit on create/resume (via
// adoptActiveSession) or filled lazily from disk (ensureActiveSessionLoaded), so
// persistActiveSession never re-reads session.json just to preserve
// createdAt/lastResumedAt. Grouping the fields means every session transition
// sets them all together — a new field can't be wired into one transition and
// silently forgotten in another.
interface ActiveSessionState {
  elaboratedPrompts: ElaboratedPromptRecord[]
  draft: SessionDraft
  createdAt: string
  lastResumedAt: string | null
}
let activeSession: ActiveSessionState | null = null

// The draft changes on every keystroke in the prompt/seed/elaborated fields, so
// its write-through is coalesced (the renderer sends each change un-debounced,
// mirroring Draw Things model-param autosave). persistActiveSession rewrites the
// whole manifest, so coalescing keeps large sessions from doing a full serialize
// per keystroke. draftWriter.drain() flushes a pending write on quit and before
// switching sessions so nothing typed is lost.
const DRAFT_PERSIST_DEBOUNCE_MS = 300
const draftWriter = createCoalescedWriter({
  flush: () => persistActiveSession(),
  debounceMs: DRAFT_PERSIST_DEBOUNCE_MS,
  onError: (error) =>
    log('error', 'Failed to persist session draft', {
      error: serializeError(error),
    }),
  onDrain: () => log('info', 'Drained pending session draft write'),
})

export function createTaskCounts(tasksByBackend: Record<BackendId, Task[]>): SessionTaskCounts {
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

export function collectSessionThumbnails(tasksByBackend: Record<BackendId, Task[]>, limit = 3): SessionThumbnail[] {
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

// A stored elaborated-prompt entry: a record, or the bare string of an older
// manifest (normalized to a record on read).
function isElaboratedPromptEntry(entry: unknown): boolean {
  if (typeof entry === 'string') return true
  if (!entry || typeof entry !== 'object') return false
  const candidate = entry as Partial<ElaboratedPromptRecord>
  return (
    typeof candidate.text === 'string' &&
    Array.isArray(candidate.concepts) &&
    candidate.concepts.every(
      (c) => !!c && typeof c === 'object' &&
        typeof (c as ConceptCredit).facet === 'string' &&
        typeof (c as ConceptCredit).concept === 'string'
    )
  )
}

/** Repair one stored entry: legacy strings become credit-less records, and
 *  anything neither shape yields null for the caller to drop. */
function normalizeElaboratedPrompt(entry: unknown): ElaboratedPromptRecord | null {
  if (typeof entry === 'string') return { text: entry, concepts: [] }
  if (!isElaboratedPromptEntry(entry)) return null
  const record = entry as ElaboratedPromptRecord
  return { text: record.text, concepts: record.concepts.map((c) => ({ ...c })) }
}

/** All entries, repaired; unrecognizable ones dropped with a warn. Exported
 *  for the tests that pin the repair behavior. */
export function normalizeElaboratedPrompts(entries: readonly unknown[]): ElaboratedPromptRecord[] {
  const repaired: ElaboratedPromptRecord[] = []
  let dropped = 0
  for (const entry of entries) {
    const record = normalizeElaboratedPrompt(entry)
    if (record) repaired.push(record)
    else dropped++
  }
  if (dropped > 0) {
    log('warn', 'Dropped unrecognizable elaborated-prompt entries', { dropped, kept: repaired.length })
  }
  return repaired
}

export function isSessionManifest(value: unknown): value is SessionManifest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SessionManifest>
  if (candidate.version !== SESSION_MANIFEST_VERSION) return false
  if (typeof candidate.sessionId !== 'string') return false
  if (typeof candidate.createdAt !== 'string') return false
  if (typeof candidate.updatedAt !== 'string') return false
  if (!(candidate.lastResumedAt === null || typeof candidate.lastResumedAt === 'string')) return false
  // Shape only — entries are repaired on read, not validated here. This field
  // sits inside the all-or-nothing manifest check, and no prompt entry ever
  // justifies costing a session its task history: like the draft below, bad
  // entries are dropped by normalizeElaboratedPrompts instead of failing the
  // whole file. (An earlier cut validated each entry and would have made one
  // truncated write unresumable.)
  if (!Array.isArray(candidate.elaboratedPrompts)) return false
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
      elaboratedPrompts: normalizeElaboratedPrompts(parsed.elaboratedPrompts),
      // draft is intentionally not validated by isSessionManifest: a missing or
      // malformed draft must not discard an otherwise-good session, so it is
      // repaired to a clean draft here instead.
      draft: normalizeSessionDraft((parsed as Partial<SessionManifest>).draft),
      tasks: normalizedTasks,
    }
  } catch (error) {
    log('warn', 'Ignoring unreadable session manifest', {
      filePath,
      error: serializeError(error),
    })
    return null
  }
}

// Replaces the active-session state as a unit. Used by create/resume so they
// can't set some fields and forget others.
function adoptActiveSession(state: ActiveSessionState): void {
  activeSession = state
}

// Returns the active-session state, loading it from disk on first use. read
// Manifest already normalizes the draft, so it stays canonical without a second
// pass. Skipped entirely once create/resume have adopted state directly.
function ensureActiveSessionLoaded(): ActiveSessionState {
  if (activeSession) return activeSession
  const manifest = readManifestFromDir(getSessionDir())
  activeSession = manifest
    ? {
        elaboratedPrompts: [...manifest.elaboratedPrompts],
        draft: manifest.draft,
        createdAt: manifest.createdAt,
        lastResumedAt: manifest.lastResumedAt,
      }
    : {
        elaboratedPrompts: [],
        draft: createEmptySessionDraft(),
        createdAt: new Date().toISOString(),
        lastResumedAt: null,
      }
  return activeSession
}

function buildManifest(sessionId: string, tasksByBackend: Record<BackendId, Task[]>): SessionManifest {
  const session = ensureActiveSessionLoaded()
  return {
    version: SESSION_MANIFEST_VERSION,
    sessionId,
    createdAt: session.createdAt,
    updatedAt: new Date().toISOString(),
    lastResumedAt: session.lastResumedAt,
    taskCounts: createTaskCounts(tasksByBackend),
    elaboratedPrompts: [...session.elaboratedPrompts],
    // session.draft is always normalized (set only from readManifest, an empty
    // draft, or setActiveSessionDraft), so no extra clone/normalize is needed.
    draft: session.draft,
    // tasksByBackend is already a fresh clone (getAllStoredTasks maps cloneTask),
    // and the manifest is serialized synchronously below, so we don't re-clone.
    tasks: tasksByBackend,
  }
}

function ensureSessionId(sessionId: string): string {
  if (!sessionId || path.basename(sessionId) !== sessionId) {
    throw new Error('Invalid session id.')
  }
  return sessionId
}

export function toInterruptedTask(task: Task): Task {
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

export function normalizeResumedQueues(tasksByBackend: Record<BackendId, Task[]>): Record<BackendId, Task[]> {
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
//
// The log call states the intent before the destructive operation, so the line
// records what was attempted even if the op then throws.
async function dropSession(sessionDir: string, sessionId: string, reason: string): Promise<void> {
  if (!fs.existsSync(sessionDir)) return
  const toTrash = shouldDeleteToTrash(loadConfig().general.delete_to_trash)
  log('info', 'Dropping empty session', { reason, sessionId, path: sessionDir, toTrash })
  if (toTrash) {
    await shell.trashItem(sessionDir)
  } else {
    fs.rmSync(sessionDir, { recursive: true, force: true })
  }
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

// Fired whenever the active session changes (new session, resume into another).
// Renderer-side session-scoped contexts (e.g. SessionDraftContext) listen to
// this to re-hydrate their in-memory state from the now-active session.
function broadcastSessionChanged(sessionId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('session:changed', { sessionId })
  }
}

// Fired after resuming a session that still has tasks left unfinished when it
// was last open. The renderer uses this to prompt the user to re-queue them.
function broadcastInterruptedOnResume(count: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('session:interruptedTasks', { count })
  }
}

export function resolveSessionDir(sessionId: string): string {
  const safeSessionId = ensureSessionId(sessionId)
  return path.join(getOutputDir(), safeSessionId)
}

export function persistActiveSession(): SessionManifest {
  const sessionDir = getSessionDir()
  fs.mkdirSync(sessionDir, { recursive: true })
  // buildManifest loads the active-session state if it isn't loaded yet.
  const manifest = buildManifest(getSessionId(), queueManager.getAllStoredTasks())
  // not recorded: session.json is a generator-session manifest under output/<session>/ — imagequeue
  // is an image GENERATOR, and its output/ sessions are transient, harvest-then-discard drops the user
  // picks over and exports keepers from, not the app's reloaded durable state. The whole output/ tree
  // (session dirs, their session.json manifests, the generated images) is app output,
  // excluded wholesale as a binary-bearing directory (data-backup conventions: "Harvest-then-discard
  // output"; "Anything colocated in a binary-bearing directory").
  writeJsonAtomic(getManifestPath(sessionDir), manifest, false)
  return manifest
}

// Flush a pending coalesced draft write synchronously. Called on quit so a
// keystroke made just before Cmd+Q isn't lost in the debounce gap, and before
// switching away from a session so the outgoing session's draft lands on disk.
export function drainPendingDraftWrites(): void {
  draftWriter.drain()
}

export async function createSession(): Promise<void> {
  if (queueManager.hasGeneratingTasks()) {
    throw new Error('Wait for active generation to finish before starting a new session.')
  }

  const previousSessionDir = getSessionDir()
  const previousSessionId = getSessionId()
  const dropPrevious = shouldAutoDropSession(queueManager.getAllStoredTasks())

  // The explicit persist below captures the outgoing draft when the session is
  // kept; either way, cancel the pending timer so it can't fire after the
  // switch and write the old draft into the new session.
  draftWriter.cancel()
  if (!dropPrevious) persistActiveSession()

  const sessionDir = createSessionDir()
  setSessionDir(sessionDir)
  log('info', 'Session started', { sessionDir })
  queueManager.replaceAllTasks(createEmptyQueues())
  resetOutputTimestampAllocators()
  adoptActiveSession({
    elaboratedPrompts: [],
    draft: createEmptySessionDraft(),
    createdAt: new Date().toISOString(),
    lastResumedAt: null,
  })
  persistActiveSession()
  publishQueueState()
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

  // Capture the outgoing session's pending draft before we switch away (unless
  // it's being dropped). Unlike createSession, resume does not persist the
  // previous session wholesale, so this flush is what saves its draft.
  if (dropPrevious) draftWriter.cancel()
  else draftWriter.drain()

  const sessionDir = resolveSessionDir(sessionId)
  const manifest = readManifestFromDir(sessionDir)
  if (!manifest) {
    throw new Error('That session is missing a readable session.json file.')
  }

  const resumedQueues = normalizeResumedQueues(manifest.tasks)
  setSessionDir(sessionDir)
  log('info', 'Session resumed', { sessionDir })
  queueManager.replaceAllTasks(resumedQueues)
  resetOutputTimestampAllocators()
  seedOutputTimestampAllocators(manifest.tasks)
  adoptActiveSession({
    elaboratedPrompts: [...manifest.elaboratedPrompts],
    // manifest.draft is already normalized by readManifestFromDir.
    draft: manifest.draft,
    createdAt: manifest.createdAt,
    lastResumedAt: new Date().toISOString(),
  })
  persistActiveSession()
  publishQueueState()
  broadcastSessionChanged(getSessionId())

  const interruptedCount = collectTasks(resumedQueues).filter((task) => task.status === 'interrupted').length
  if (interruptedCount > 0) broadcastInterruptedOnResume(interruptedCount)

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

export function getActiveSessionDraft(): SessionDraft {
  // draft is always normalized; the IPC boundary structured-clones the return
  // value, so no live module reference escapes to the renderer.
  return ensureActiveSessionLoaded().draft
}

export function setActiveSessionDraft(draft: SessionDraft): void {
  // Trust boundary: the draft arrives over IPC, so normalize it here.
  ensureActiveSessionLoaded().draft = normalizeSessionDraft(draft)
  draftWriter.schedule()
}

export function getActiveSessionElaboratedPrompts(): ElaboratedPromptRecord[] {
  return [...ensureActiveSessionLoaded().elaboratedPrompts]
}

export function appendActiveSessionElaboratedPrompts(
  prompts: ElaboratedPromptRecord[]
): ElaboratedPromptRecord[] {
  if (prompts.length === 0) return getActiveSessionElaboratedPrompts()
  const session = ensureActiveSessionLoaded()
  session.elaboratedPrompts = [...session.elaboratedPrompts, ...prompts]
  persistActiveSession()
  return [...session.elaboratedPrompts]
}

export function deleteActiveSessionElaboratedPromptAt(index: number): ElaboratedPromptRecord[] {
  const session = ensureActiveSessionLoaded()
  if (index < 0 || index >= session.elaboratedPrompts.length) return [...session.elaboratedPrompts]
  session.elaboratedPrompts = session.elaboratedPrompts.filter((_, promptIndex) => promptIndex !== index)
  persistActiveSession()
  return [...session.elaboratedPrompts]
}

export function clearActiveSessionElaboratedPrompts(): ElaboratedPromptRecord[] {
  ensureActiveSessionLoaded().elaboratedPrompts = []
  persistActiveSession()
  return []
}
