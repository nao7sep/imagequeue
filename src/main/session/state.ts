import fs from 'fs'
import path from 'path'
import { shell } from 'electron'
import { broadcastPresentation } from '../presentation'
import {
  ConceptCredit,
  ElaboratedPromptRecord,
  BACKEND_IDS_IN_UI_ORDER,
  BackendId,
  SessionManifest,
  SessionListEntry,
  SessionSummary,
  UnopenableSession,
  SessionTaskCounts,
  SessionThumbnail,
  Task,
  TaskStatus,
} from '../../shared/types'
import { createEmptySessionDraft, isStoredSessionDraft, normalizeSessionDraft, type SessionDraft } from '../../shared/session-draft'
import { isMessage } from '../../shared/i18n/translate'
import { loadConfig } from '../config'
import { log, serializeError } from '../logger'
import { shouldDeleteToTrash, shouldDropEmptySessions } from '../../shared/config'
import { cloneTask, createEmptyQueues, queueManager } from '../queue/queue-manager'
import { createSessionDir, getOutputDir, getSessionDir, getSessionId, setSessionDir } from './session'
import { resetOutputTimestampAllocators, seedOutputTimestampAllocators } from './output-timestamps'
import { writeJsonAtomic } from '../utils/atomic-write'
import { createCoalescedWriter } from '../utils/coalesced-writer'
import { publishQueueState } from '../queue/publisher'
import { markDraftPersistenceFailed, markDraftPersistenceSaved } from './draft-persistence'
import { checkFormat, FORMAT_VERSIONS, NewerFormatError, StoreLeftInPlaceError } from '../store-format'

import { isStoredTaskParams } from './stored-task-params'

const SESSION_MANIFEST_FILENAME = 'session.json'

// Single source of truth for the active session's renderer-facing manifest
// fields: the prompt/elaboration working state plus its times. null until
// loaded; replaced as a whole unit on create/resume (via adoptActiveSession) or
// filled lazily from disk (ensureActiveSessionLoaded), so persistActiveSession
// never re-reads session.json just to preserve them. Grouping the fields means
// every session transition sets them all together — a new field can't be wired
// into one transition and silently forgotten in another.
//
// updatedAt follows the content-lifecycle-conventions' Modified rule, at the
// time of the edit. saved is the content last saved, which persistActiveSession
// judges each write against. The draft is saved a pause after it is typed, so
// draftEditedAt keeps when it last changed; everything else is saved by the
// call that changed it, so restSeen keeps when a save first found it as it is,
// and a failed write does not move that time to a later save.
interface ActiveSessionState {
  elaboratedPrompts: ElaboratedPromptRecord[]
  draft: SessionDraft
  createdAt: string
  updatedAt: string
  lastResumedAt: string | null
  saved: SessionContent
  draftEditedAt: string | null
  restSeen: { rest: string; at: string }
}
let activeSession: ActiveSessionState | null = null

let sessionMutationPending = false

export async function mutateSession<T>(operation: () => Promise<T>): Promise<T> {
  if (sessionMutationPending) throw new Error('Wait for the current session operation to finish.')
  sessionMutationPending = true
  try {
    return await operation()
  } finally {
    sessionMutationPending = false
  }
}

// The draft changes on every keystroke in the prompt/seed/elaborated fields, so
// its write-through is coalesced (the renderer sends each change un-debounced,
// mirroring Draw Things model-param autosave). persistActiveSession rewrites the
// whole manifest, so coalescing keeps large sessions from doing a full serialize
// per keystroke. draftWriter.drain() flushes a pending write on quit and before
// switching sessions so nothing typed is lost.
const DRAFT_PERSIST_DEBOUNCE_MS = 300
const draftWriter = createCoalescedWriter({
  flush: () => {
    persistActiveSession()
    markDraftPersistenceSaved()
  },
  debounceMs: DRAFT_PERSIST_DEBOUNCE_MS,
  onError: (error) => {
    log('error', 'Failed to persist session draft', {
      error: serializeError(error),
    })
    markDraftPersistenceFailed()
  },
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

function isElaboratedPromptEntry(entry: unknown): entry is ElaboratedPromptRecord {
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

// A manifest as read: its format version is checked and set aside before this.
type StoredSessionManifest = Omit<SessionManifest, 'formatVersion'>

const TASK_STATUSES: readonly TaskStatus[] = ['queued', 'generating', 'completed', 'kept', 'failed', 'interrupted']

// A stored task holds every field the app reads or writes back; an absent
// nullable field reads as null.
function isStoredTask(value: unknown): value is Task {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const task = value as Record<string, unknown>
  const nullable = (field: unknown, check: (present: unknown) => boolean): boolean =>
    field === undefined || field === null || check(field)
  const isString = (field: unknown): boolean => typeof field === 'string'
  return (
    typeof task.id === 'string' && task.id.length > 0 &&
    typeof task.prompt === 'string' &&
    BACKEND_IDS_IN_UI_ORDER.includes(task.backend as BackendId) &&
    typeof task.model === 'string' &&
    !!task.params && typeof task.params === 'object' && !Array.isArray(task.params) &&
    isStoredTaskParams(task.backend as BackendId, task.model as string, task.params as Record<string, unknown>) &&
    TASK_STATUSES.includes(task.status as TaskStatus) &&
    typeof task.enqueuedAt === 'string' &&
    nullable(task.startedAt, isString) &&
    nullable(task.completedAt, isString) &&
    nullable(task.durationMs, (field) => typeof field === 'number') &&
    nullable(task.imagePath, isString) &&
    nullable(task.baseName, isString) &&
    nullable(task.error, isMessage) &&
    nullable(task.providerMessage, isString)
  )
}

// The manifest's members the app consumes or writes back are checked here, at
// the read boundary: one that is not usable makes the session unreadable,
// listed in place with its bytes untouched, rather than repaired and saved
// over (store-recovery conventions). A task list for a backend this build does
// not have is not read.
export function isSessionManifest(value: unknown): value is StoredSessionManifest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StoredSessionManifest>
  if (typeof candidate.sessionId !== 'string') return false
  if (typeof candidate.createdAt !== 'string') return false
  if (typeof candidate.updatedAt !== 'string') return false
  if (!(candidate.lastResumedAt === null || typeof candidate.lastResumedAt === 'string')) return false
  if (!Array.isArray(candidate.elaboratedPrompts) || !candidate.elaboratedPrompts.every(isElaboratedPromptEntry)) return false
  if (!isStoredSessionDraft(candidate.draft)) return false
  if (!candidate.taskCounts || typeof candidate.taskCounts !== 'object') return false
  if (!candidate.tasks || typeof candidate.tasks !== 'object') return false
  const ids = new Set<string>()
  return BACKEND_IDS_IN_UI_ORDER.every((backend) => {
    const tasks: unknown = candidate.tasks?.[backend]
    return Array.isArray(tasks) && tasks.every((task: unknown) => {
      if (!isStoredTask(task) || task.backend !== backend || ids.has(task.id)) return false
      ids.add(task.id)
      return true
    })
  })
}

// A folder with no session.json is not a session; one whose session.json cannot
// be opened is, and says why.
type ManifestRead =
  | { manifest: StoredSessionManifest }
  | { manifest: null; problem: 'missing' | UnopenableSession['unopenable']; error?: unknown }

function readManifestFromDir(sessionDir: string): ManifestRead {
  const filePath = getManifestPath(sessionDir)
  if (!fs.existsSync(filePath)) return { manifest: null, problem: 'missing' }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid session manifest shape')
    const parsed = checkFormat(raw as Record<string, unknown>, FORMAT_VERSIONS.session, filePath)
    if (!isSessionManifest(parsed)) {
      throw new Error('Invalid session manifest shape')
    }
    return { manifest: {
      ...parsed,
      elaboratedPrompts: parsed.elaboratedPrompts.map((record) => ({
        text: record.text,
        concepts: record.concepts.map((credit) => ({ ...credit })),
      })),
      draft: normalizeSessionDraft(parsed.draft),
    } }
  } catch (error) {
    // An unreadable or newer manifest is listed, never opened, so nothing
    // writes over it.
    const newer = error instanceof NewerFormatError
    log('warn', newer ? 'Ignoring a session manifest from a newer version' : 'Ignoring unreadable session manifest', {
      filePath,
      error: serializeError(error),
    })
    return { manifest: null, problem: newer ? 'newer' : 'unreadable', error }
  }
}

// The open session's manifest was checked when it was loaded, and the
// single-instance lock keeps every other writer out, so only a session that is
// not open is checked before it is deleted.
function admitSessionManifest(sessionDir: string): void {
  const read = readManifestFromDir(sessionDir)
  if (read.manifest) return
  if (read.error instanceof NewerFormatError) throw read.error
  throw new StoreLeftInPlaceError(getManifestPath(sessionDir), {
    cause: read.error ?? new Error('Session manifest is missing'),
  })
}

// The part of a session the Modified rule counts as content: the draft, the
// elaborated prompts, and each task's request and saved image. A task's status,
// timing and failure are its lifecycle, not content.
interface SessionContent {
  draft: string
  rest: string
}

function sessionContent(
  draft: SessionDraft,
  elaboratedPrompts: ElaboratedPromptRecord[],
  tasksByBackend: Record<BackendId, Task[]>,
): SessionContent {
  return {
    draft: JSON.stringify(draft),
    rest: JSON.stringify({
      elaboratedPrompts,
      tasks: BACKEND_IDS_IN_UI_ORDER.map((backend) =>
        (tasksByBackend[backend] ?? []).map((task) => [task.id, task.prompt, task.model, task.params, task.baseName])
      ),
    }),
  }
}

export function sessionContentKey(
  draft: SessionDraft,
  elaboratedPrompts: ElaboratedPromptRecord[],
  tasksByBackend: Record<BackendId, Task[]>,
): string {
  const { draft: draftKey, rest } = sessionContent(draft, elaboratedPrompts, tasksByBackend)
  return `${draftKey}\n${rest}`
}

interface AdoptedSession {
  elaboratedPrompts: ElaboratedPromptRecord[]
  draft: SessionDraft
  createdAt: string
  updatedAt: string
  lastResumedAt: string | null
}

// Replaces the active-session state as a unit. Used by create/resume so they
// can't set some fields and forget others. `tasks` is what the session holds as
// it is adopted: the content later writes are judged against.
function adoptActiveSession(state: AdoptedSession, tasks: Record<BackendId, Task[]>): ActiveSessionState {
  const saved = sessionContent(state.draft, state.elaboratedPrompts, tasks)
  activeSession = {
    ...state,
    saved,
    draftEditedAt: null,
    restSeen: { rest: saved.rest, at: state.updatedAt },
  }
  return activeSession
}

// A session that has just been made: nothing in it, updated when it was created.
function newSessionState(): AdoptedSession {
  const createdAt = new Date().toISOString()
  return {
    elaboratedPrompts: [],
    draft: createEmptySessionDraft(),
    createdAt,
    updatedAt: createdAt,
    lastResumedAt: null,
  }
}

// Returns the active-session state, loading it from disk on first use. read
// Manifest already normalizes the draft, so it stays canonical without a second
// pass. Skipped entirely once create/resume have adopted state directly.
function ensureActiveSessionLoaded(): ActiveSessionState {
  if (activeSession) return activeSession
  const { manifest } = readManifestFromDir(getSessionDir())
  return manifest
    ? adoptActiveSession({
        elaboratedPrompts: [...manifest.elaboratedPrompts],
        draft: manifest.draft,
        createdAt: manifest.createdAt,
        updatedAt: manifest.updatedAt,
        lastResumedAt: manifest.lastResumedAt,
      }, manifest.tasks)
    : adoptActiveSession(newSessionState(), createEmptyQueues())
}

function buildManifest(
  sessionId: string,
  session: ActiveSessionState,
  updatedAt: string,
  tasksByBackend: Record<BackendId, Task[]>,
): SessionManifest {
  return {
    formatVersion: FORMAT_VERSIONS.session,
    sessionId,
    createdAt: session.createdAt,
    updatedAt,
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

// Opening a session interrupts only the work that was in flight when it was
// last open; finished and failed tasks keep their outcome.
export function toResumedTask(task: Task): Task {
  if (task.status !== 'queued' && task.status !== 'generating') return cloneTask(task)
  return {
    ...cloneTask(task),
    status: 'interrupted',
    startedAt: null,
    completedAt: null,
    durationMs: null,
    imagePath: null,
    baseName: null,
    error: null,
    providerMessage: null,
  }
}

export function normalizeResumedQueues(tasksByBackend: Record<BackendId, Task[]>): Record<BackendId, Task[]> {
  const normalized = createEmptyQueues()
  for (const backend of BACKEND_IDS_IN_UI_ORDER) {
    normalized[backend] = (tasksByBackend[backend] ?? []).map(toResumedTask)
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
// and the session is empty. The directory goes with its session.json, draft
// included, on purpose: an empty session is an abandoned start, and a user
// never returns to one for its draft.
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

export function dropCurrentSessionIfEmpty(reason: string): Promise<boolean> {
  return mutateSession(() => dropCurrentSessionIfEmptyOwned(reason))
}

async function dropCurrentSessionIfEmptyOwned(reason: string): Promise<boolean> {
  if (!shouldAutoDropSession(queueManager.getAllStoredTasks())) return false
  await dropSession(getSessionDir(), getSessionId(), reason)
  return true
}

// Fired whenever the active session changes (new session, resume into another).
// Renderer-side session-scoped contexts (e.g. SessionDraftContext) listen to
// this to re-hydrate their in-memory state from the now-active session.
function broadcastSessionChanged(sessionId: string): void {
  broadcastPresentation('session:changed', { sessionId })
}

// Fired after resuming a session that still has tasks left unfinished when it
// was last open. The renderer uses this to prompt the user to re-queue them.
function broadcastInterruptedOnResume(count: number): void {
  broadcastPresentation('session:interruptedTasks', { count })
}

export function resolveSessionDir(sessionId: string): string {
  const safeSessionId = ensureSessionId(sessionId)
  return path.join(getOutputDir(), safeSessionId)
}

export function persistActiveSession(): SessionManifest {
  const sessionDir = getSessionDir()
  fs.mkdirSync(sessionDir, { recursive: true })
  const session = ensureActiveSessionLoaded()
  const tasks = queueManager.getAllStoredTasks()
  const now = new Date().toISOString()
  const content = sessionContent(session.draft, session.elaboratedPrompts, tasks)
  if (content.rest !== session.restSeen.rest) session.restSeen = { rest: content.rest, at: now }
  const editTimes = [
    ...(content.draft !== session.saved.draft ? [session.draftEditedAt ?? now] : []),
    ...(content.rest !== session.saved.rest ? [session.restSeen.at] : []),
  ]
  const updatedAt = editTimes.length === 0 ? session.updatedAt : editTimes.sort().at(-1)!
  const manifest = buildManifest(getSessionId(), session, updatedAt, tasks)
  // not recorded: a session, its images and its elaborated prompts are transient
  // work the user exports what they keep from (data-backup-conventions; the
  // developer's classification), so session.json has no backup history.
  writeJsonAtomic(getManifestPath(sessionDir), manifest, false)
  // Only a write that landed moves the baseline, so content a failed write
  // never saved still counts as an edit on the next one.
  session.saved = content
  session.updatedAt = updatedAt
  return manifest
}

// Flush a pending coalesced draft write synchronously. Called on quit so a
// keystroke made just before Cmd+Q isn't lost in the debounce gap, and before
// switching away from a session so the outgoing session's draft lands on disk.
export function drainPendingDraftWrites(): void {
  draftWriter.drain()
}

export function createSession(): Promise<void> {
  return mutateSession(() => createSessionOwned())
}

async function createSessionOwned(): Promise<void> {
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
  adoptActiveSession(newSessionState(), createEmptyQueues())
  persistActiveSession()
  markDraftPersistenceSaved()
  publishQueueState()
  broadcastSessionChanged(getSessionId())

  if (dropPrevious) {
    await dropSession(previousSessionDir, previousSessionId, 'new-session')
  }
}

// Sessions it can open, most recently updated first, then those it cannot,
// newest folder first.
export function listSessions(): SessionListEntry[] {
  const outputDir = getOutputDir()
  const currentSessionId = getSessionId()
  const entries = fs.readdirSync(outputDir, { withFileTypes: true })
  const summaries: SessionSummary[] = []
  const unopenable: UnopenableSession[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const read = readManifestFromDir(path.join(outputDir, entry.name))
    if (!read.manifest) {
      if (read.problem !== 'missing') unopenable.push({ sessionId: entry.name, unopenable: read.problem })
      continue
    }
    const { manifest } = read
    const displayCounts = createSessionDisplayCounts(manifest.tasks)
    // The folder is the session's identity: resume, delete and thumbnails all
    // resolve the folder by this id. The manifest's own sessionId goes stale when
    // the user copies or renames a folder, so it never names one here.
    summaries.push({
      sessionId: entry.name,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      lastResumedAt: manifest.lastResumedAt,
      taskCounts: manifest.taskCounts,
      completedCount: displayCounts.completedCount,
      retryCount: displayCounts.retryCount,
      keptCount: displayCounts.keptCount,
      thumbnails: collectSessionThumbnails(manifest.tasks),
      isCurrent: entry.name === currentSessionId,
    })
  }

  summaries.sort((a, b) => {
    const updatedDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    if (updatedDiff !== 0) return updatedDiff
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
  unopenable.sort((a, b) => (a.sessionId < b.sessionId ? 1 : a.sessionId > b.sessionId ? -1 : 0))
  return [...summaries, ...unopenable]
}

export function resumeSession(sessionId: string): Promise<void> {
  return mutateSession(() => resumeSessionOwned(sessionId))
}

async function resumeSessionOwned(sessionId: string): Promise<void> {
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
  const { manifest } = readManifestFromDir(sessionDir)
  if (!manifest) {
    throw new Error('That session is missing a readable session.json file.')
  }

  const resumedQueues = normalizeResumedQueues(manifest.tasks)
  setSessionDir(sessionDir)
  log('info', 'Session resumed', { sessionDir })
  queueManager.replaceAllTasks(resumedQueues)
  resetOutputTimestampAllocators()
  seedOutputTimestampAllocators(manifest.tasks)
  // Judged against the resumed queues: lifecycle changes are not content edits.
  adoptActiveSession({
    elaboratedPrompts: [...manifest.elaboratedPrompts],
    // manifest.draft is already normalized by readManifestFromDir.
    draft: manifest.draft,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    lastResumedAt: new Date().toISOString(),
  }, resumedQueues)
  persistActiveSession()
  markDraftPersistenceSaved()
  publishQueueState()
  broadcastSessionChanged(getSessionId())

  const interruptedCount = collectTasks(resumedQueues).filter((task) => task.status === 'interrupted').length
  if (interruptedCount > 0) broadcastInterruptedOnResume(interruptedCount)

  if (dropPrevious && previousSessionId !== sessionId) {
    await dropSession(previousSessionDir, previousSessionId, 'resume')
  }
}

export function deleteSession(sessionId: string): Promise<void> {
  return mutateSession(() => deleteSessionOwned(sessionId))
}

async function deleteSessionOwned(sessionId: string): Promise<void> {
  if (sessionId === getSessionId()) {
    throw new Error('The current session cannot be deleted while it is open.')
  }

  const sessionDir = resolveSessionDir(sessionId)
  if (!fs.existsSync(sessionDir)) {
    throw new Error('That session folder no longer exists.')
  }
  admitSessionManifest(sessionDir)

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
  const session = ensureActiveSessionLoaded()
  session.draft = normalizeSessionDraft(draft)
  session.draftEditedAt = new Date().toISOString()
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
