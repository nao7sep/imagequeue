import fs from 'fs'
import path from 'path'
import { shell } from 'electron'
import { broadcastPresentation } from '../presentation'
import {
  ConceptCredit,
  ElaboratedPromptRecord,
  EnqueueBatchUnit,
  BACKEND_IDS_IN_UI_ORDER,
  BackendId,
  SessionManifest,
  SessionListEntry,
  SessionSummary,
  UnopenableSession,
  SessionThumbnail,
  Task,
  TaskStatus,
} from '../../shared/types'
import { createEmptySessionDraft, normalizeSessionDraft, type SessionDraft } from '../../shared/session-draft'
import { isMessage } from '../../shared/i18n/translate'
import { loadConfig } from '../config'
import { log, serializeError } from '../logger'
import { shouldDeleteToTrash, shouldDropEmptySessions } from '../../shared/config'
import { cloneTask, createEmptyQueues, queueManager } from '../queue/queue-manager'
import { createSessionDir, getSessionsDir, getSessionDir, getSessionId, setSessionDir } from './session'
import { resetOutputTimestampAllocators, seedOutputTimestampAllocators } from './output-timestamps'
import { publishQueueState } from '../queue/publisher'
import { checkFormat, FORMAT_VERSIONS, NewerFormatError, StoreLeftInPlaceError } from '../store-format'

import { SessionJournal, taskMaps, applyTransition, tasksFromMaps, countTasks } from './session-journal'
import { readSessionJournal, type SessionTransition } from './journal-file'
export { sessionContentKey } from './session-journal'

import { isStoredTaskParams } from './stored-task-params'
import { isPendingTaskOutput, recoverPublishedOutput } from './output-recovery'

const SESSION_MANIFEST_FILENAME = 'session.json'

// One active session owns prompt content, times and its ordered durable journal.
// Captured writes retain the time an edit was first observed across retries.
interface ActiveSessionState {
  elaboratedPrompts: ElaboratedPromptRecord[]
  createdAt: string
  updatedAt: string
  lastResumedAt: string | null
  journal: SessionJournal
}
let activeSession: ActiveSessionState | null = null
let activeSessionLoad: { directory: string; promise: Promise<ActiveSessionState> } | null = null

// Each session's prompt draft, kept for the running app only. The prompt pane
// has no save action and enqueuing copies its text, so the draft is uncommitted
// work (unsaved-edits-conventions): it survives switching between sessions,
// is not written to session.json, and is gone after restart. Quit discards it
// without asking (developer decision).
const drafts = new Map<string, SessionDraft>()

let sessionMutationPending = false
let sessionMutation: Promise<unknown> = Promise.resolve()
let writes: Promise<unknown> = Promise.resolve()
let writeFailure: unknown = null
// Only adoption/deletion of this particular archive waits for its readers.
const archiveReads = new Map<string, ReturnType<typeof readManifestFromDir>>()

export function isSessionMutationPending(): boolean { return sessionMutationPending }

/** Quit waits for real settlement, including a caller that stopped waiting. */
export async function drainSessionWrites(): Promise<void> {
  await sessionMutation
  await writes
  if (writeFailure) throw writeFailure
}

export async function mutateSession<T>(operation: () => Promise<T>): Promise<T> {
  if (sessionMutationPending) throw new Error('Wait for the current session operation to finish.')
  sessionMutationPending = true
  try {
    const pending = writes.then(operation)
    sessionMutation = pending.catch(() => undefined)
    return await pending
  } finally {
    sessionMutationPending = false
  }
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
// A draft stored by an earlier build is ignored.
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
    nullable(task.providerMessage, isString) &&
    (task.pendingOutput === undefined || isPendingTaskOutput(task.pendingOutput))
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
  if (candidate.journalSequence !== undefined && (!Number.isSafeInteger(candidate.journalSequence) || candidate.journalSequence < 0)) return false
  if (typeof candidate.createdAt !== 'string') return false
  if (typeof candidate.updatedAt !== 'string') return false
  if (!(candidate.lastResumedAt === null || typeof candidate.lastResumedAt === 'string')) return false
  if (!Array.isArray(candidate.elaboratedPrompts) || !candidate.elaboratedPrompts.every(isElaboratedPromptEntry)) return false
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

function isSessionTransition(value: unknown): value is SessionTransition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Partial<SessionTransition>
  if (typeof row.updatedAt !== 'string' || !Array.isArray(row.upserts) || !Array.isArray(row.removed)) return false
  if (row.elaboratedPrompts !== undefined && (!Array.isArray(row.elaboratedPrompts) || !row.elaboratedPrompts.every(isElaboratedPromptEntry))) return false
  const ids = new Set<string>()
  for (const task of row.upserts) {
    if (!isStoredTask(task) || ids.has(task.id)) return false
    ids.add(task.id)
  }
  for (const task of row.removed) {
    if (!task || typeof task !== 'object' || typeof task.id !== 'string' || !task.id ||
      !BACKEND_IDS_IN_UI_ORDER.includes(task.backend) || ids.has(task.id)) return false
    ids.add(task.id)
  }
  return true
}

// A folder with no session.json is not a session; one whose session.json cannot
// be opened is, and says why.
type ManifestRead =
  | { manifest: StoredSessionManifest; journalBytes: number }
  | { manifest: null; problem: 'missing' | UnopenableSession['unopenable']; error?: unknown }

export async function readManifestFromDir(sessionDir: string): Promise<ManifestRead> {
  const filePath = getManifestPath(sessionDir)

  try {
    const raw = JSON.parse(await fs.promises.readFile(filePath, 'utf-8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid session manifest shape')
    const parsed = checkFormat(raw as Record<string, unknown>, FORMAT_VERSIONS.session, filePath)
    if (!isSessionManifest(parsed)) {
      throw new Error('Invalid session manifest shape')
    }
    const checkpointSequence = parsed.journalSequence ?? 0
    const maps = taskMaps(parsed.tasks)
    const owners = new Map(Object.values(parsed.tasks).flat().map(task => [task.id, task.backend]))
    const journal = await readSessionJournal(sessionDir, checkpointSequence, isSessionTransition, transition => {
      for (const task of transition.upserts) {
        if (owners.has(task.id) && owners.get(task.id) !== task.backend) throw new Error('Journal task changes backend')
        owners.set(task.id, task.backend)
      }
      for (const task of transition.removed) {
        if (owners.has(task.id) && owners.get(task.id) !== task.backend) throw new Error('Journal removal changes backend')
        owners.delete(task.id)
      }
      applyTransition(maps, transition)
      parsed.updatedAt = transition.updatedAt
      if (transition.elaboratedPrompts) parsed.elaboratedPrompts = transition.elaboratedPrompts
    })
    const tasks = tasksFromMaps(maps)
    return { manifest: { ...parsed, tasks, taskCounts: countTasks(tasks), journalSequence: journal.sequence },
      journalBytes: journal.sequence === checkpointSequence ? 0 : journal.validBytes }

  } catch (error) {
    // An unreadable or newer manifest is listed, never opened, so nothing
    // writes over it.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { manifest: null, problem: 'missing' }
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
async function admitSessionManifest(sessionDir: string): Promise<void> {
  const read = await readManifestFromDir(sessionDir)
  if (read.manifest) return
  if (read.error instanceof NewerFormatError) throw read.error
  throw new StoreLeftInPlaceError(getManifestPath(sessionDir), {
    cause: read.error ?? new Error('Session manifest is missing'),
  })
}

interface AdoptedSession {
  journalSequence?: number
  elaboratedPrompts: ElaboratedPromptRecord[]
  createdAt: string
  updatedAt: string
  lastResumedAt: string | null
}

// The active-session state for a session holding `tasks` as it is adopted: the
// content later writes are judged against. Built whole, so create/resume can't
// set some fields and forget others.
function sessionState(state: AdoptedSession, tasks: Record<BackendId, Task[]>, directory = getSessionDir(), journalBytes = 0, checkpointRequired = false): ActiveSessionState {
  const manifest: SessionManifest = {
    ...state, formatVersion: FORMAT_VERSIONS.session, sessionId: path.basename(directory),
    tasks, taskCounts: countTasks(tasks),
  }
  return { ...state, journal: new SessionJournal(directory, manifest, journalBytes, checkpointRequired) }
}

// A session that has just been made: nothing in it, updated when it was created.
function newSessionState(): AdoptedSession {
  const createdAt = new Date().toISOString()
  return {
    elaboratedPrompts: [],
    createdAt,
    updatedAt: createdAt,
    lastResumedAt: null,
  }
}

// Returns the active-session state, loading it from disk on first use. Skipped
// entirely once create/resume have adopted state directly.
async function ensureActiveSessionLoaded(): Promise<ActiveSessionState> {
  const directory = getSessionDir()
  if (activeSession?.journal.directory === directory) return activeSession
  if (activeSessionLoad?.directory === directory) return activeSessionLoad.promise
  const promise = (async () => {
    const read = await readManifestFromDir(directory)
    if (!read.manifest && read.problem !== 'missing') {
      throw new StoreLeftInPlaceError(getManifestPath(directory), { cause: read.error })
    }
    const { manifest } = read
    const session = manifest
      ? sessionState({
          elaboratedPrompts: [...manifest.elaboratedPrompts],
          createdAt: manifest.createdAt,
          updatedAt: manifest.updatedAt,
          lastResumedAt: manifest.lastResumedAt,
          journalSequence: manifest.journalSequence,
        }, manifest.tasks, directory, read.manifest ? read.journalBytes : 0)
      : sessionState(newSessionState(), createEmptyQueues(), directory, 0, true)
    activeSession = session
    return session
  })()
  activeSessionLoad = { directory, promise }
  try { return await promise } finally {
    if (activeSessionLoad?.promise === promise) activeSessionLoad = null
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
// and the session is empty. The directory goes with its session.json; drafts
// live only in memory and are not part of the manifest.
//
// The log call states the intent before the destructive operation, so the line
// records what was attempted even if the op then throws.
async function dropSession(sessionDir: string, sessionId: string, reason: string): Promise<void> {
  try { await fs.promises.lstat(sessionDir) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const toTrash = shouldDeleteToTrash(loadConfig().general.delete_to_trash)
  log('info', 'Dropping empty session', { reason, sessionId, path: sessionDir, toTrash })
  if (toTrash) {
    await shell.trashItem(sessionDir)
  } else {
    await fs.promises.rm(sessionDir, { recursive: true, force: true })
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
  return path.join(getSessionsDir(), safeSessionId)
}

export async function persistActiveSession(): Promise<{ updatedAt: string }> {
  const session = await ensureActiveSessionLoaded()
  const changes = queueManager.captureChanges('durability')
  const snapshot = session.journal.capture(changes, session.elaboratedPrompts)
  // Capture before I/O and acknowledge only this revision after physical
  // settlement. Newer mutations survive an older successful write.
  const write = writes.catch(() => undefined).then(async () => {
    const result = await session.journal.commit(snapshot)
    session.updatedAt = result.updatedAt
    queueManager.ackChanges('durability', changes.revision)
    writeFailure = null
    return result
  })
  writes = write.catch(error => { writeFailure = error })
  return write
}

// Switches main to a session whose manifest was just written, so main and the
// renderer move together: a session is adopted only once its first write
// landed, and a failure before that leaves both on the outgoing session.
function adoptSession(sessionDir: string, session: ActiveSessionState, tasks: Record<BackendId, Task[]>): void {
  setSessionDir(sessionDir)
  queueManager.replaceAllTasks(tasks)
  queueManager.ackChanges('durability', queueManager.currentRevision)
  activeSession = session
  publishQueueState()
  broadcastSessionChanged(getSessionId())
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
  if (!dropPrevious) await persistActiveSession()

  const sessionDir = await createSessionDir()
  const tasks = createEmptyQueues()
  let session: ActiveSessionState
  try {
    session = sessionState(newSessionState(), tasks, sessionDir)
    await session.journal.checkpoint()
  } catch (error) {
    // The new folder holds no session yet; removing it keeps the list clean.
    try { await fs.promises.rm(sessionDir, { recursive: true, force: true }) } catch { /* The write failure is the one to report. */ }
    throw error
  }
  resetOutputTimestampAllocators()
  adoptSession(sessionDir, session, tasks)
  log('info', 'Session started', { sessionDir })

  if (dropPrevious) {
    await dropPreviousSessionAfterSwitch(previousSessionDir, previousSessionId, 'new-session')
  }
}

// Adoption has committed. Optional cleanup cannot turn the successful switch
// into a failed command; a folder left behind keeps its running-app draft too.
async function dropPreviousSessionAfterSwitch(sessionDir: string, sessionId: string, reason: string): Promise<void> {
  try {
    await dropSession(sessionDir, sessionId, reason)
    drafts.delete(sessionId)
  } catch (error) {
    log('warn', 'Session switched, but its empty predecessor could not be removed', { sessionId, reason, error: serializeError(error) })
  }
}

// Queue refreshes need only the active in-memory snapshot, including kept rows
// hidden by the renderer. They must never replay unrelated archive journals.
export async function getActiveSessionSummary(): Promise<SessionSummary> {
  while (sessionMutationPending) await sessionMutation
  await writes
  const session = await ensureActiveSessionLoaded()
  const tasks = queueManager.getAllStoredTasks()
  return {
    sessionId: path.basename(session.journal.directory),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastResumedAt: session.lastResumedAt,
    taskCounts: countTasks(tasks),
    ...createSessionDisplayCounts(tasks),
    thumbnails: collectSessionThumbnails(tasks),
    isCurrent: true,
  }
}

// Sessions it can open, most recently updated first, then those it cannot,
// newest folder first.
export async function listSessions(): Promise<SessionListEntry[]> {
  while (sessionMutationPending) await sessionMutation
  await writes
  return listSessionsOwned()
}

async function readListedSession(directory: string): ReturnType<typeof readManifestFromDir> {
  while (sessionMutationPending) await sessionMutation
  if (directory === getSessionDir()) {
    // A checkpoint and its compacted journal are one read. Only this active
    // read shares the writer chain; slow unrelated archives never hold it.
    const reading = writes.then(() => readManifestFromDir(directory))
    writes = reading.catch(() => undefined)
    return reading
  }
  const existing = archiveReads.get(directory)
  if (existing) return existing
  const reading = readManifestFromDir(directory)
  archiveReads.set(directory, reading)
  try { return await reading } finally { archiveReads.delete(directory) }
}

async function listSessionsOwned(): Promise<SessionListEntry[]> {
  const sessionsDir = getSessionsDir()
  const entries = await fs.promises.readdir(sessionsDir, { withFileTypes: true })
  const summaries: SessionSummary[] = []
  const unopenable: UnopenableSession[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const read = await readListedSession(path.join(sessionsDir, entry.name))
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
      isCurrent: false,
    })
  }

  for (const summary of summaries) summary.isCurrent = summary.sessionId === getSessionId()
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
  // The outgoing session is saved first; a failed write refuses the switch and
  // keeps everything as it is.
  if (!dropPrevious) await persistActiveSession()

  const sessionDir = resolveSessionDir(sessionId)
  await archiveReads.get(sessionDir)
  const { manifest } = await readManifestFromDir(sessionDir)
  if (!manifest) {
    throw new Error('That session is missing a readable session.json file.')
  }

  // This identity was saved before publication. Inspect it before classifying
  // unfinished work, so a crash after the paid image landed never invites a
  // second generation merely because the final lifecycle save was interrupted.
  let recoveredUpdatedAt = manifest.updatedAt
  for (const task of collectTasks(manifest.tasks)) {
    if (await recoverPublishedOutput(task, sessionDir) && task.completedAt &&
      Date.parse(task.completedAt) > Date.parse(recoveredUpdatedAt)) recoveredUpdatedAt = task.completedAt
  }
  const resumedQueues = normalizeResumedQueues(manifest.tasks)
  // Judged against the resumed queues: lifecycle changes are not content edits.
  const session = sessionState({
    elaboratedPrompts: [...manifest.elaboratedPrompts],
    createdAt: manifest.createdAt,
    updatedAt: recoveredUpdatedAt,
    lastResumedAt: new Date().toISOString(),
    journalSequence: manifest.journalSequence,
  }, resumedQueues, sessionDir)
  await session.journal.checkpoint()
  resetOutputTimestampAllocators()
  seedOutputTimestampAllocators(manifest.tasks)
  adoptSession(sessionDir, session, resumedQueues)
  log('info', 'Session resumed', { sessionDir })

  const interruptedCount = collectTasks(resumedQueues).filter((task) => task.status === 'interrupted').length
  if (interruptedCount > 0) broadcastInterruptedOnResume(interruptedCount)

  if (dropPrevious) {
    await dropPreviousSessionAfterSwitch(previousSessionDir, previousSessionId, 'resume')
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
  await archiveReads.get(sessionDir)
  await admitSessionManifest(sessionDir)

  const toTrash = shouldDeleteToTrash(loadConfig().general.delete_to_trash)
  if (toTrash) {
    await shell.trashItem(sessionDir)
  } else {
    await fs.promises.rm(sessionDir, { recursive: true, force: true })
  }
  drafts.delete(sessionId)
}

export function getActiveSessionDraft(): SessionDraft {
  // The IPC boundary structured-clones the return value, so no live module
  // reference escapes to the renderer.
  return drafts.get(getSessionId()) ?? createEmptySessionDraft()
}

export function setActiveSessionDraft(draft: SessionDraft): void {
  // Trust boundary: the draft arrives over IPC, so normalize it here.
  drafts.set(getSessionId(), normalizeSessionDraft(draft))
}

export async function getActiveSessionElaboratedPrompts(): Promise<ElaboratedPromptRecord[]> {
  return [...(await ensureActiveSessionLoaded()).elaboratedPrompts]
}

/** Called inside the queue command's session mutation. Capture task intent and
 * its prompt provenance before that command takes one journal snapshot. */
export async function enqueueActiveSessionBatch(units: EnqueueBatchUnit[], prompts: ElaboratedPromptRecord[]): Promise<Task[]> {
  const session = await ensureActiveSessionLoaded()
  const tasks = queueManager.enqueueBatch(units)
  session.elaboratedPrompts = [...session.elaboratedPrompts, ...prompts]
  return tasks
}

export async function appendActiveSessionElaboratedPrompts(
  prompts: ElaboratedPromptRecord[]
): Promise<ElaboratedPromptRecord[]> {
  return mutateSession(async () => {
    if (prompts.length === 0) return getActiveSessionElaboratedPrompts()
    const session = await ensureActiveSessionLoaded()
    session.elaboratedPrompts = [...session.elaboratedPrompts, ...prompts]
    await persistActiveSession()
    return [...session.elaboratedPrompts]
  })
}

export async function deleteActiveSessionElaboratedPromptAt(index: number): Promise<ElaboratedPromptRecord[]> {
  return mutateSession(async () => {
    const session = await ensureActiveSessionLoaded()
    if (index < 0 || index >= session.elaboratedPrompts.length) return [...session.elaboratedPrompts]
    session.elaboratedPrompts = session.elaboratedPrompts.filter((_, promptIndex) => promptIndex !== index)
    await persistActiveSession()
    return [...session.elaboratedPrompts]
  })
}

export async function clearActiveSessionElaboratedPrompts(): Promise<ElaboratedPromptRecord[]> {
  return mutateSession(async () => {
    (await ensureActiveSessionLoaded()).elaboratedPrompts = []
    await persistActiveSession()
    return []
  })
}
