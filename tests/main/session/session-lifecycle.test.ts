import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'node:crypto'
import * as journalFile from '../../../src/main/session/journal-file'
import * as sync from '../../../src/main/utils/fsync'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BackendId, SessionManifest, SessionSummary, Task, TaskStatus } from '../../../src/shared/types'

// Sessions are folders of the user's generated images with a manifest beside
// them, so these paths are exercised against a real output directory: what the
// manifest says, which folder is current, and — for the drop/delete paths —
// whether a folder is really gone. Only Electron, the config file, the log sink
// and the renderer publisher are substituted.
const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())
vi.mock('../../../src/main/ipc-boundary', () => ({
  handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
}))
const send = vi.hoisted(() => vi.fn())
const trashItem = vi.hoisted(() => vi.fn(async (_path: string) => {}))
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ webContents: { send } }] },
  shell: { trashItem },
}))

const settings = vi.hoisted(() => ({ dataDir: '', deleteToTrash: false, dropEmptySessions: false }))
vi.mock('../../../src/main/config', () => ({
  getDataDir: () => settings.dataDir,
  loadConfig: () => ({
    general: {
      delete_to_trash: settings.deleteToTrash,
      drop_empty_sessions: settings.dropEmptySessions,
    },
  }),
}))

const log = vi.hoisted(() => vi.fn())
vi.mock('../../../src/main/logger', () => ({ log, logEnqueue: vi.fn(), serializeError: (error: unknown) => String(error) }))

const publishQueueState = vi.hoisted(() => vi.fn())
vi.mock('../../../src/main/queue/publisher', () => ({ publishQueueState }))

// Sessions are named to the second, so each one these tests start begins a
// second after the last, as sessions a person starts do; a same-second clash
// has a test of its own (session.test.ts).
const sessionClock = vi.hoisted(() => ({ next: Date.UTC(2026, 0, 1) }))
vi.mock('../../../src/main/session/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/session/session')>()
  return { ...actual, createSessionDir: async () => (await actual.createSessionDir(new Date(sessionClock.next += 1_000))) }
})

const recordBackup = vi.hoisted(() => vi.fn())
vi.mock('../../../src/main/backup/backup-store', () => ({ record: recordBackup, closeBackupStore: async () => undefined }))

const {
  createSession,
  deleteSession,
  dropCurrentSessionIfEmpty,
  drainSessionWrites,
  getActiveSessionDraft,
  getActiveSessionSummary,
  appendActiveSessionElaboratedPrompts,
  clearActiveSessionElaboratedPrompts,
  deleteActiveSessionElaboratedPromptAt,
  getActiveSessionElaboratedPrompts,
  listSessions,
  persistActiveSession,
  resumeSession,
  readManifestFromDir,
  setActiveSessionDraft,
} = await import('../../../src/main/session/state')
const { getSessionsDir, getSessionDir, getSessionId, setSessionDir } = await import('../../../src/main/session/session')
const { createEmptyQueues, queueManager } = await import('../../../src/main/queue/queue-manager')
const { registerQueueIpc } = await import('../../../src/main/queue/ipc')
registerQueueIpc()
const { createEmptySessionDraft } = await import('../../../src/shared/session-draft')
const { FORMAT_VERSIONS, NewerFormatError, StoreLeftInPlaceError } = await import('../../../src/main/store-format')

function makeTask(id: string, status: TaskStatus, extra: Partial<Task> = {}): Task {
  return {
    id,
    prompt: 'a cat',
    backend: 'openai',
    model: 'm',
    params: {},
    status,
    enqueuedAt: '2026-01-01T00:00:00.000Z',
    startedAt: status === 'queued' ? null : '2026-01-01T00:00:01.000Z',
    completedAt: status === 'completed' || status === 'kept' ? '2026-01-01T00:00:02.000Z' : null,
    durationMs: null,
    imagePath: status === 'completed' || status === 'kept' ? '/x.png' : null,
    baseName: status === 'completed' || status === 'kept' ? `base-${id}` : null,
    error: null,
    providerMessage: null,
    ...extra,
  }
}

function withTasks(tasks: Task[]): Record<BackendId, Task[]> {
  const queues = createEmptyQueues()
  for (const task of tasks) queues[task.backend].push(task)
  return queues
}

async function readManifest(sessionDir: string): Promise<Omit<SessionManifest, 'formatVersion'>> {
  const result = await readManifestFromDir(sessionDir)
  if (!result.manifest) throw new Error('Expected a readable durable session')
  return result.manifest
}

function readCheckpoint(sessionDir: string): SessionManifest {
  return JSON.parse(fs.readFileSync(path.join(sessionDir, 'session.json'), 'utf8')) as SessionManifest
}

/** A session folder on disk that this process never opened. */
function stageSession(sessionId: string, manifest: Partial<SessionManifest> & Record<string, unknown> = {}): string {
  const dir = path.join(getSessionsDir(), sessionId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'session.json'),
    JSON.stringify({
      formatVersion: FORMAT_VERSIONS.session,
      sessionId,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastResumedAt: null,
      taskCounts: { total: 0, queued: 0, generating: 0, completed: 0, failed: 0, interrupted: 0, kept: 0 },
      elaboratedPrompts: [],
      tasks: createEmptyQueues(),
      ...manifest,
    }),
    'utf-8',
  )
  return dir
}

function sent(channel: string): unknown[] {
  return send.mock.calls.filter((call) => call[0] === channel).map((call) => call[1])
}

beforeEach(async () => {
  vi.clearAllMocks()
  settings.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-session-'))
  settings.deleteToTrash = false
  settings.dropEmptySessions = false
  // A session this process is "already in", so each test starts from a known
  // current session rather than whatever the previous test left behind.
  setSessionDir(path.join(getSessionsDir(), '20260101-000000-utc'))
  queueManager.replaceAllTasks(createEmptyQueues())
  stageSession('20260101-000000-utc')
  // Dropped as it is left, so each test starts with exactly one session folder.
  settings.dropEmptySessions = true
  await createSession()
  settings.dropEmptySessions = false
  vi.clearAllMocks()
})

afterEach(() => {
  fs.rmSync(settings.dataDir, { recursive: true, force: true })
})

describe('starting a new session', () => {
  it('admits and saves a multi-backend batch under one held session operation', async () => {
    const appendOriginal = journalFile.appendSessionTransition
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const held = new Promise<void>((resolve) => { release = resolve })
    let saved = 0
    const append = vi.spyOn(journalFile, 'appendSessionTransition').mockImplementationOnce(async (...args) => {
      entered()
      await held
      return appendOriginal(...args)
    })
    const units = [
      { backend: 'openai', model: 'first', prompt: 'a cat', params: { quality: 'low' } },
      { backend: 'flux', model: 'second', prompt: 'a cat', params: { aspectRatio: '1:1' } },
    ]
    const prompts = [{ text: 'a cat', concepts: [{ facet: 'animal', concept: 'cat' }] }]
    const submission = handlers.get('queue:enqueueBatch')!({}, units, prompts)
    await started
    try {
      expect(queueManager.getAllStoredTasks().openai).toHaveLength(1)
      expect(queueManager.getAllStoredTasks().flux).toHaveLength(1)
      expect(publishQueueState).not.toHaveBeenCalled()
      await expect(createSession()).rejects.toThrow(/current session operation/)
    } finally {
      release()
      await submission
      saved = append.mock.calls.length
      append.mockRestore()
    }
    expect((await readManifest(getSessionDir())).tasks).toMatchObject({
      openai: [expect.objectContaining({ model: 'first' })],
      flux: [expect.objectContaining({ model: 'second' })],
    })
    expect((await readManifest(getSessionDir())).elaboratedPrompts).toEqual(prompts)
    expect(publishQueueState).toHaveBeenCalledOnce()
    expect(saved).toBe(1)
  })
  it('opens a fresh folder with an empty manifest and tells the window', async () => {
    const previous = getSessionDir()
    queueManager.replaceAllTasks(withTasks([makeTask('a', 'completed')]))

    await createSession()

    expect(getSessionDir()).not.toBe(previous)
    const manifest = readCheckpoint(getSessionDir())
    expect(manifest).toMatchObject({
      formatVersion: FORMAT_VERSIONS.session,
      sessionId: getSessionId(),
      lastResumedAt: null,
      taskCounts: expect.objectContaining({ total: 0 }),
      elaboratedPrompts: [],
    })
    expect(manifest.tasks).toEqual(createEmptyQueues())
    expect(queueManager.getAllStoredTasks()).toEqual(createEmptyQueues())
    expect(sent('session:changed')).toEqual([{ sessionId: getSessionId() }])
    expect(publishQueueState).toHaveBeenCalled()
  })

  it('leaves the outgoing session on disk with the work it held', async () => {
    const previous = getSessionDir()
    queueManager.replaceAllTasks(withTasks([makeTask('a', 'completed'), makeTask('b', 'kept')]))

    await createSession()

    expect((await readManifest(previous)).tasks.openai.map((task) => task.id)).toEqual(['a', 'b'])
  })

  it('drops an outgoing session that holds nothing, when the setting says so', async () => {
    settings.dropEmptySessions = true
    const previous = getSessionDir()

    await createSession()

    expect(fs.existsSync(previous), 'the empty folder is gone').toBe(false)
    expect(trashItem).not.toHaveBeenCalled()
    expect(fs.existsSync(getSessionDir())).toBe(true)
  })

  it('sends a dropped session to the Trash when the user keeps deletions recoverable', async () => {
    settings.dropEmptySessions = true
    settings.deleteToTrash = true
    const previous = getSessionDir()

    await createSession()

    expect(trashItem).toHaveBeenCalledExactlyOnceWith(previous)
  })

  it('refuses while images are still being generated', async () => {
    const current = getSessionDir()
    queueManager.replaceAllTasks(withTasks([makeTask('a', 'generating')]))

    await expect(createSession()).rejects.toThrow(/Wait for active generation/)
    expect(getSessionDir(), 'the open session is untouched').toBe(current)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('listing sessions', () => {
  it('reports each readable session, newest first, and marks the open one', async () => {
    stageSession('20260102-000000-utc', { updatedAt: '2026-01-02T00:00:00.000Z' })
    stageSession('20260103-000000-utc', {
      updatedAt: '2026-01-03T00:00:00.000Z',
      tasks: withTasks([makeTask('a', 'completed'), makeTask('b', 'kept'), makeTask('c', 'failed')]),
    })

    const summaries = (await listSessions()) as SessionSummary[]

    expect(summaries.map((summary) => summary.sessionId)).toEqual([
      getSessionId(),
      '20260103-000000-utc',
      '20260102-000000-utc',
    ])
    expect(summaries.map((summary) => summary.isCurrent)).toEqual([true, false, false])
    expect(summaries[1]).toMatchObject({ completedCount: 1, keptCount: 1, retryCount: 1 })
    expect(summaries[1].thumbnails.map((thumbnail) => thumbnail.baseName)).toEqual(['base-a'])
  })

  it('identifies a copied or renamed folder by its folder, so acting on it never touches the original', async () => {
    const original = stageSession('20260106-000000-utc', { updatedAt: '2026-01-06T00:00:00.000Z' })
    const copy = path.join(getSessionsDir(), '20260106-000000-utc copy')
    fs.cpSync(original, copy, { recursive: true })

    const ids = (await listSessions()).map((summary) => summary.sessionId)
    expect(ids).toContain('20260106-000000-utc')
    expect(ids).toContain('20260106-000000-utc copy')

    await deleteSession('20260106-000000-utc copy')
    expect(fs.existsSync(copy)).toBe(false)
    expect(fs.existsSync(original), 'the original survives deleting its copy').toBe(true)
  })

  it('passes over a folder with no manifest', async () => {
    fs.mkdirSync(path.join(getSessionsDir(), 'not-a-session'), { recursive: true })

    expect((await listSessions()).map((summary) => summary.sessionId)).toEqual([getSessionId()])
  })

  it('lists a folder whose manifest it cannot open in place, by folder and reason, after the sessions it can open, and leaves its files as they were', async () => {
    const broken = path.join(getSessionsDir(), '20260104-000000-utc')
    fs.mkdirSync(broken, { recursive: true })
    fs.writeFileSync(path.join(broken, 'session.json'), '{ not json', 'utf-8')
    fs.writeFileSync(path.join(broken, 'image.png'), 'image bytes')
    const newer = stageSession('20260105-000000-utc', { formatVersion: FORMAT_VERSIONS.session + 1 })
    const snapshot = (dir: string) => Object.fromEntries(fs.readdirSync(dir).map((name) => [name, fs.readFileSync(path.join(dir, name), 'utf-8')]))
    const before = { broken: snapshot(broken), newer: snapshot(newer) }

    expect((await listSessions())).toEqual([
      expect.objectContaining({ sessionId: getSessionId(), isCurrent: true }),
      { sessionId: '20260105-000000-utc', unopenable: 'newer' },
      { sessionId: '20260104-000000-utc', unopenable: 'unreadable' },
    ])
    expect(log).toHaveBeenCalledWith('warn', 'Ignoring unreadable session manifest', expect.anything())
    await expect(resumeSession('20260104-000000-utc')).rejects.toThrow(/missing a readable session.json/)
    await expect(resumeSession('20260105-000000-utc')).rejects.toThrow(/missing a readable session.json/)

    expect({ broken: snapshot(broken), newer: snapshot(newer) }).toEqual(before)
  })
})

describe('resuming a session', () => {
  it('loads its work, marks what was in flight, and says how much was interrupted', async () => {
    const staged = stageSession('20260105-000000-utc', {
      tasks: withTasks([
        makeTask('done', 'completed'),
        makeTask('refused', 'failed'),
        makeTask('midway', 'generating'),
        makeTask('waiting', 'queued'),
      ]),
    })

    await resumeSession('20260105-000000-utc')

    expect(getSessionDir()).toBe(staged)
    const resumed = queueManager.getAllStoredTasks().openai
    expect(resumed.map((task) => [task.id, task.status])).toEqual([
      ['done', 'completed'],
      ['refused', 'failed'],
      ['midway', 'interrupted'],
      ['waiting', 'interrupted'],
    ])
    expect(sent('session:changed')).toEqual([{ sessionId: '20260105-000000-utc' }])
    expect(sent('session:interruptedTasks'), 'a failure is not offered for another run').toEqual([{ count: 2 }])
    expect((await readManifest(staged)).lastResumedAt, 'the resume is stamped on disk').not.toBeNull()
  })

  it('keeps a failed task failed, with its reason and the provider\'s words', async () => {
    const refusal = { key: 'taskFailure.refused', values: { name: 'Grok' } } as const
    stageSession('20260111-000000-utc', {
      tasks: withTasks([
        makeTask('refused', 'failed', { backend: 'grok', error: refusal, providerMessage: 'Generated image rejected by content moderation.' }),
      ]),
    })

    await resumeSession('20260111-000000-utc')

    expect(queueManager.getAllStoredTasks().grok).toEqual([expect.objectContaining({
      status: 'failed',
      error: refusal,
      providerMessage: 'Generated image rejected by content moderation.',
      startedAt: '2026-01-01T00:00:01.000Z',
    })])
    expect(sent('session:interruptedTasks')).toEqual([])
  })

  it('says nothing about interruptions when everything had finished', async () => {
    stageSession('20260106-000000-utc', { tasks: withTasks([makeTask('done', 'completed')]) })

    await resumeSession('20260106-000000-utc')

    expect(sent('session:interruptedTasks')).toEqual([])
  })

  it('does nothing when the session asked for is already open', async () => {
    const current = getSessionId()

    await resumeSession(current)

    expect(send).not.toHaveBeenCalled()
    expect(publishQueueState).not.toHaveBeenCalled()
  })

  it('refuses a session with no readable manifest, and one that is not there', async () => {
    fs.mkdirSync(path.join(getSessionsDir(), '20260107-000000-utc'), { recursive: true })

    await expect(resumeSession('20260107-000000-utc')).rejects.toThrow(/missing a readable session.json/)
    await expect(resumeSession('20260108-000000-utc')).rejects.toThrow(/missing a readable session.json/)
  })

  it('refuses while images are still being generated', async () => {
    stageSession('20260109-000000-utc')
    queueManager.replaceAllTasks(withTasks([makeTask('a', 'generating')]))

    await expect(resumeSession('20260109-000000-utc')).rejects.toThrow(/Wait for active generation/)
  })

  it('drops the session being left behind when it holds nothing and the setting says so', async () => {
    settings.dropEmptySessions = true
    const previous = getSessionDir()
    stageSession('20260110-000000-utc')

    await resumeSession('20260110-000000-utc')

    expect(fs.existsSync(previous)).toBe(false)
  })
})

describe('a session an earlier version named to the millisecond', () => {
  it('lists, opens and deletes like any other', async () => {
    const id = '20260101-000000-123-utc'
    stageSession(id, { tasks: withTasks([makeTask('a', 'completed')]) })
    expect((await listSessions()).some((entry) => entry.sessionId === id && !('unopenable' in entry))).toBe(true)
    await resumeSession(id)
    expect(getSessionId()).toBe(id)
    await createSession()
    await deleteSession(id)
    expect(fs.existsSync(path.join(getSessionsDir(), id))).toBe(false)
  })
})

describe('deleting a session', () => {
  it('removes the folder for good', async () => {
    const staged = stageSession('20260111-000000-utc')

    await deleteSession('20260111-000000-utc')

    expect(fs.existsSync(staged)).toBe(false)
    expect(trashItem).not.toHaveBeenCalled()
  })

  it('sends it to the Trash when the user keeps deletions recoverable', async () => {
    settings.deleteToTrash = true
    const staged = stageSession('20260112-000000-utc')

    await deleteSession('20260112-000000-utc')

    expect(trashItem).toHaveBeenCalledExactlyOnceWith(staged)
    expect(fs.existsSync(staged), 'the Trash move is the OS handler’s to make').toBe(true)
  })

  it('refuses to delete the session that is open', async () => {
    await expect(deleteSession(getSessionId())).rejects.toThrow(/cannot be deleted while it is open/)
    expect(fs.existsSync(getSessionDir())).toBe(true)
  })

  it('refuses when the folder is already gone', async () => {
    await expect(deleteSession('20260113-000000-utc')).rejects.toThrow(/left unchanged/)
  })
})

describe('session operations awaiting Trash', () => {
  it.each(['resume', 'new'] as const)('refuses to reopen outgoing A during %s cleanup', async (operation) => {
    settings.dropEmptySessions = true
    settings.deleteToTrash = true
    const previousDir = getSessionDir()
    const previousId = getSessionId()
    const targetId = '20260114-000000-utc'
    stageSession(targetId, { tasks: withTasks([makeTask('B', 'completed')]) })
    let settle!: () => void
    trashItem.mockImplementationOnce((dir) => new Promise<void>((resolve) => {
      settle = () => { fs.rmSync(dir, { recursive: true, force: true }); resolve() }
    }))
    const mutation = operation === 'resume' ? resumeSession(targetId) : createSession()
    await vi.waitFor(() => expect(settle).toBeTypeOf('function'))
    const adoptedDir = getSessionDir()
    try {
      expect(adoptedDir).not.toBe(previousDir)
      await expect(resumeSession(previousId)).rejects.toThrow(/current session operation/)
      await expect(createSession()).rejects.toThrow(/current session operation/)
      await expect(deleteSession(previousId)).rejects.toThrow(/current session operation/)
      expect(getSessionDir()).toBe(adoptedDir)
    } finally {
      settle()
      await mutation
    }
    expect(fs.existsSync(previousDir)).toBe(false)
    expect(fs.existsSync(adoptedDir)).toBe(true)
    settings.dropEmptySessions = false
    await createSession()
  })

  it('refuses to adopt a session whose explicit deletion is in flight', async () => {
    settings.deleteToTrash = true
    const targetId = '20260114-000000-utc'
    const targetDir = stageSession(targetId)
    const currentDir = getSessionDir()
    let settle!: () => void
    trashItem.mockImplementationOnce((dir) => new Promise<void>((resolve) => {
      settle = () => { fs.rmSync(dir, { recursive: true, force: true }); resolve() }
    }))
    const deletion = deleteSession(targetId)
    await vi.waitFor(() => expect(settle).toBeTypeOf('function'))
    try {
      await expect(resumeSession(targetId)).rejects.toThrow(/current session operation/)
      expect(getSessionDir()).toBe(currentDir)
    } finally {
      settle()
      await deletion
    }
    expect(fs.existsSync(targetDir)).toBe(false)
  })

  it.each([false, true])('finishes durable A task deletion before allowing Resume B (Trash failure: %s)', async (fail) => {
    settings.deleteToTrash = true
    const originalDir = getSessionDir()
    const originalId = getSessionId()
    const targetId = '20260114-000000-utc'
    stageSession(targetId, { tasks: withTasks([makeTask('same', 'completed', { prompt: 'B image' })]) })
    queueManager.replaceAllTasks(withTasks([makeTask('same', 'completed', {
      baseName: 'A-image', imagePath: path.join(originalDir, 'A-image.png'),
    })]))
    fs.writeFileSync(path.join(originalDir, 'A-image.png'), 'image')
    await persistActiveSession()
    let settle!: () => void
    trashItem.mockImplementationOnce((file) => new Promise<void>((resolve, reject) => {
      settle = () => {
        if (fail) reject(new Error('Trash failed'))
        else { fs.unlinkSync(file); resolve() }
      }
    }))
    const deletion = handlers.get('queue:deleteWithFiles')!({}, 'openai', 'same')
    await vi.waitFor(() => expect(settle).toBeTypeOf('function'))
    try {
      await expect(resumeSession(targetId)).rejects.toThrow(/current session operation/)
      expect(getSessionDir()).toBe(originalDir)
    } finally {
      settle()
      await deletion
    }
    expect((await readManifest(originalDir)).tasks.openai).toEqual([])
    await resumeSession(targetId)
    expect(queueManager.getTask('openai', 'same')).toMatchObject({ prompt: 'B image' })
    await resumeSession(originalId)
    expect(queueManager.getAllStoredTasks().openai).toEqual([])
  })

  it.each(['new', 'resume'])('keeps the committed %s switch successful when optional Trash fails', async (action) => {
    settings.dropEmptySessions = true
    settings.deleteToTrash = true
    const previousDir = getSessionDir()
    const previousId = getSessionId()
    setActiveSessionDraft({ ...createEmptySessionDraft(), prompt: 'retained draft' })
    const targetId = '20260114-000000-utc'
    const targetDir = stageSession(targetId, { tasks: withTasks([makeTask('B', 'completed')]) })
    trashItem.mockRejectedValueOnce(new Error('Trash failed'))
    await expect(action === 'resume' ? resumeSession(targetId) : createSession()).resolves.toBeUndefined()
    if (action === 'resume') expect(getSessionDir()).toBe(targetDir)
    else expect(getSessionDir()).not.toBe(previousDir)
    expect(fs.existsSync(previousDir)).toBe(true)
    expect(log).toHaveBeenCalledWith('warn', 'Session switched, but its empty predecessor could not be removed', expect.objectContaining({ sessionId: previousId }))
    settings.dropEmptySessions = false
    await resumeSession(previousId)
    expect(getActiveSessionDraft().prompt).toBe('retained draft')
  })

  it('reports the actual deletion when the final manifest save fails, then saves it on retry', async () => {
    const dir = getSessionDir()
    queueManager.replaceAllTasks(withTasks([makeTask('deleted', 'completed', {
      baseName: 'image', imagePath: 'image.png',
    })]))
    fs.writeFileSync(path.join(dir, 'image.png'), 'image')
    fs.writeFileSync(path.join(dir, 'image.json'), '{}')
    await persistActiveSession()
    publishQueueState.mockClear()
    vi.spyOn(journalFile, 'appendSessionTransition').mockRejectedValueOnce(new Error('manifest unavailable'))
    try {
      await expect(handlers.get('queue:deleteWithFiles')!({}, 'openai', 'deleted')).resolves.toMatchObject({ removed: true, sessionSaved: false })
      expect(fs.existsSync(path.join(dir, 'image.png'))).toBe(false)
      expect(fs.existsSync(path.join(dir, 'image.json'))).toBe(false)
      expect(queueManager.getTask('openai', 'deleted')).toBeUndefined()
      expect(publishQueueState).toHaveBeenCalledOnce()
      expect((await readManifest(dir)).tasks.openai).toHaveLength(1)
      await expect(drainSessionWrites()).rejects.toThrow('manifest unavailable')
      await persistActiveSession()
      expect((await readManifest(dir)).tasks.openai).toEqual([])
      await expect(drainSessionWrites()).resolves.toBeUndefined()
    } finally { vi.restoreAllMocks() }
  })
})

describe('dropping the open session on quit', () => {
  it('leaves a session that holds work', async () => {
    settings.dropEmptySessions = true
    queueManager.replaceAllTasks(withTasks([makeTask('a', 'completed')]))

    await expect(dropCurrentSessionIfEmpty('quit')).resolves.toBe(false)
    expect(fs.existsSync(getSessionDir())).toBe(true)
  })

  it('drops an empty one', async () => {
    settings.dropEmptySessions = true
    const current = getSessionDir()

    await expect(dropCurrentSessionIfEmpty('quit')).resolves.toBe(true)
    expect(fs.existsSync(current)).toBe(false)
  })

  it('leaves it alone when the user turned dropping off', async () => {
    await expect(dropCurrentSessionIfEmpty('quit')).resolves.toBe(false)
    expect(fs.existsSync(getSessionDir())).toBe(true)
  })
})

describe('the working draft and its elaborated prompts', () => {
  it('normalizes what the renderer sends and keeps it out of session.json', async () => {
    setActiveSessionDraft({ ...createEmptySessionDraft(), prompt: 'a cat', count: -5 })

    expect(getActiveSessionDraft().prompt).toBe('a cat')
    expect(getActiveSessionDraft().count, 'a nonsense count is repaired').toBeGreaterThan(0)
    await persistActiveSession()
    expect((await readManifest(getSessionDir()))).not.toHaveProperty('draft')
  })

  it('keeps each session\'s draft while the app runs, so switching back finds it, and its prompts', async () => {
    setActiveSessionDraft({ ...createEmptySessionDraft(), prompt: 'a cat on a shelf' })
    await appendActiveSessionElaboratedPrompts([{ text: 'a cat on a sunlit shelf', concepts: [] }])
    const first = getSessionId()
    await createSession()
    expect(getActiveSessionDraft().prompt, 'a new session starts empty').toBe('')
    setActiveSessionDraft({ ...createEmptySessionDraft(), prompt: 'a dog' })
    const second = getSessionId()

    await resumeSession(first)
    expect(getActiveSessionDraft().prompt).toBe('a cat on a shelf')
    expect((await getActiveSessionElaboratedPrompts())).toEqual([{ text: 'a cat on a sunlit shelf', concepts: [] }])

    await resumeSession(second)
    expect(getActiveSessionDraft().prompt).toBe('a dog')
  })

  it('starts with an empty draft after a restart', async () => {
    setActiveSessionDraft({ ...createEmptySessionDraft(), prompt: 'a cat' })
    await persistActiveSession()
    const dir = getSessionDir()

    vi.resetModules()
    const restarted = await import('../../../src/main/session/state')
    const { setSessionDir: setRestartedSessionDir } = await import('../../../src/main/session/session')
    setRestartedSessionDir(dir)
    expect(restarted.getActiveSessionDraft()).toEqual(createEmptySessionDraft())
  })

  it('opens a session whose manifest holds a draft an earlier version stored, and ignores that draft', async () => {
    const id = '20260114-000000-utc'
    stageSession(id, { draft: { ...createEmptySessionDraft(), prompt: 7 } })
    expect((await listSessions()).some((entry) => entry.sessionId === id && !('unopenable' in entry))).toBe(true)
    await resumeSession(id)
    expect(getActiveSessionDraft()).toEqual(createEmptySessionDraft())
  })

  it('persists every change to the elaborated list', async () => {
    ;(await appendActiveSessionElaboratedPrompts([
      { text: 'first', concepts: [] },
      { text: 'second', concepts: [] },
    ]))
    expect((await readManifest(getSessionDir())).elaboratedPrompts.map((entry) => entry.text)).toEqual(['first', 'second'])

    expect((await deleteActiveSessionElaboratedPromptAt(0)).map((entry) => entry.text)).toEqual(['second'])
    expect((await readManifest(getSessionDir())).elaboratedPrompts.map((entry) => entry.text)).toEqual(['second'])

    expect((await deleteActiveSessionElaboratedPromptAt(7)), 'an index that is not there changes nothing').toHaveLength(1)
    expect((await appendActiveSessionElaboratedPrompts([])), 'appending nothing changes nothing').toHaveLength(1)

    expect((await clearActiveSessionElaboratedPrompts())).toEqual([])
    expect((await readManifest(getSessionDir())).elaboratedPrompts).toEqual([])
  })
})

// main and the window always show the same session: a switch whose writes fail
// leaves both on the session they were on, with its work and draft.
describe('a switch whose save fails', () => {
  const failRename = (call: number): void => {
    const rename = fs.promises.rename
    let calls = 0
    vi.spyOn(fs.promises, 'rename').mockImplementation((from, to) => {
      calls += 1
      if (calls === call) throw new Error('simulated full disk')
      return rename(from, to)
    })
  }
  const holdWork = (): void => {
    queueManager.replaceAllTasks(withTasks([makeTask('a', 'completed')]))
    setActiveSessionDraft({ ...createEmptySessionDraft(), prompt: 'a cat' })
  }
  const expectUnchanged = (sessionId: string): void => {
    expect(getSessionId()).toBe(sessionId)
    expect(queueManager.getTask('openai', 'a')).toBeDefined()
    expect(getActiveSessionDraft().prompt).toBe('a cat')
    expect(sent('session:changed')).toEqual([])
  }
  afterEach(() => vi.restoreAllMocks())

  it('refuses Resume when the session being left cannot be saved', async () => {
    holdWork()
    const current = getSessionId()
    stageSession('20260116-000000-utc')
    failRename(1)
    await expect(resumeSession('20260116-000000-utc')).rejects.toThrow('simulated full disk')
    expectUnchanged(current)
  })

  it('refuses Resume when the session being opened cannot be written, leaving its manifest as it was', async () => {
    holdWork()
    const current = getSessionId()
    const target = stageSession('20260116-000000-utc')
    const bytes = fs.readFileSync(path.join(target, 'session.json'))
    failRename(2)
    await expect(resumeSession('20260116-000000-utc')).rejects.toThrow('simulated full disk')
    expectUnchanged(current)
    expect(fs.readFileSync(path.join(target, 'session.json'))).toEqual(bytes)
  })

  it('refuses New Session when the new session cannot be written, leaving no folder behind', async () => {
    holdWork()
    const current = getSessionId()
    const folders = fs.readdirSync(getSessionsDir())
    failRename(2)
    await expect(createSession()).rejects.toThrow('simulated full disk')
    expectUnchanged(current)
    expect(fs.readdirSync(getSessionsDir())).toEqual(folders)
  })
})

describe('the updated time', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  const later = (): void => {
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
  }
  const updatedAt = async (): Promise<string> => (await readManifest(getSessionDir())).updatedAt

  it('stays when a past session is opened, so the list keeps its order', async () => {
    stageSession('20260102-000000-utc', {
      updatedAt: '2026-01-02T00:00:00.000Z',
      tasks: withTasks([makeTask('done', 'completed'), makeTask('midway', 'generating')]),
    })
    stageSession('20260103-000000-utc', { updatedAt: '2026-01-03T00:00:00.000Z' })
    later()

    await resumeSession('20260102-000000-utc')

    const manifest = (await readManifest(getSessionDir()))
    expect(manifest.updatedAt).toBe('2026-01-02T00:00:00.000Z')
    expect(manifest.lastResumedAt).toBe('2026-03-01T00:00:00.000Z')
    const ids = (await listSessions()).map((summary) => summary.sessionId)
    expect(ids.indexOf('20260103-000000-utc')).toBeLessThan(ids.indexOf('20260102-000000-utc'))
  })

  it('stays on the session left behind when a new one starts', async () => {
    const previous = getSessionDir()
    queueManager.replaceAllTasks(withTasks([makeTask('a', 'completed')]))
    await persistActiveSession()
    later()

    await createSession()

    expect((await readManifest(previous)).updatedAt).toBe('2026-02-01T00:00:00.000Z')
    expect((await updatedAt()), 'a new session is updated when it is made').toBe('2026-03-01T00:00:00.000Z')
  })

  it('stays when a finished task is kept or restored, or when only statuses change', async () => {
    queueManager.replaceAllTasks(withTasks([makeTask('a', 'completed'), makeTask('b', 'failed')]))
    await persistActiveSession()
    const before = (await updatedAt())
    later()

    queueManager.keepTask('openai', 'a')
    await persistActiveSession()
    expect((await updatedAt())).toBe(before)

    queueManager.restoreTask('openai', 'a')
    queueManager.retryTask('openai', 'b')
    await persistActiveSession()
    expect((await updatedAt())).toBe(before)
  })

  it('moves on an edit to the tasks or the prompts', async () => {
    const before = (await updatedAt())
    later()
    queueManager.replaceAllTasks(withTasks([makeTask('a', 'queued')]))
    expect((await persistActiveSession()).updatedAt).toBe('2026-03-01T00:00:00.000Z')
    expect((await updatedAt())).not.toBe(before)

    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'))
    await appendActiveSessionElaboratedPrompts([{ text: 'a cat on a shelf', concepts: [] }])
    expect((await updatedAt())).toBe('2026-04-01T00:00:00.000Z')
  })

  it('keeps an edit whose save failed at its own time when a later save writes it', async () => {
    later()
    const append = vi.spyOn(journalFile, 'appendSessionTransition').mockRejectedValueOnce(new Error('simulated full disk'))
    await expect(appendActiveSessionElaboratedPrompts([{ text: 'a cat on a shelf', concepts: [] }])).rejects.toThrow('simulated full disk')
    append.mockRestore()

    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'))
    expect((await persistActiveSession()).updatedAt).toBe('2026-03-01T00:00:00.000Z')
    expect((await updatedAt())).toBe('2026-03-01T00:00:00.000Z')
  })

  it('stays when only the draft changes, since the draft is never saved', async () => {
    const before = (await updatedAt())
    later()

    setActiveSessionDraft({ ...createEmptySessionDraft(), prompt: 'a cat' })
    await persistActiveSession()

    expect((await updatedAt())).toBe(before)
  })
})

describe('a manifest member that cannot be used', () => {
  it('lists that session in place, keeps its bytes, and still lists the others', async () => {
    const damaged = stageSession('20260111-000000-utc', {
      tasks: { ...createEmptyQueues(), openai: [null] } as unknown as SessionManifest['tasks'],
    })
    const authored = stageSession('20260112-000000-utc', {
      elaboratedPrompts: [{ text: 7, concepts: [] }] as unknown as SessionManifest['elaboratedPrompts'],
    })
    stageSession('20260113-000000-utc')
    const bytes = [damaged, authored].map((dir) => fs.readFileSync(path.join(dir, 'session.json')))

    const listed = (await listSessions())
    expect(listed).toContainEqual({ sessionId: '20260111-000000-utc', unopenable: 'unreadable' })
    expect(listed).toContainEqual({ sessionId: '20260112-000000-utc', unopenable: 'unreadable' })
    expect(listed.some((entry) => entry.sessionId === '20260113-000000-utc' && !('unopenable' in entry))).toBe(true)

    await expect(resumeSession('20260112-000000-utc')).rejects.toThrow(/missing a readable session.json/)
    expect([damaged, authored].map((dir) => fs.readFileSync(path.join(dir, 'session.json')))).toEqual(bytes)
  })
})

describe('manifest identity and consumed task parameters', () => {
  it.each([
    ['empty ID', withTasks([makeTask('', 'completed')])],
    ['same-queue duplicate', withTasks([makeTask('same', 'completed'), makeTask('same', 'failed')])],
    ['cross-queue duplicate', withTasks([makeTask('same', 'completed'), makeTask('same', 'failed', { backend: 'grok' })])],
    ['wrong backend', { ...createEmptyQueues(), openai: [makeTask('wrong', 'completed', { backend: 'grok' })] }],
    ['invalid consumed number', withTasks([makeTask('bad', 'failed', { backend: 'drawthings', params: { width: 'wide' } })])],
    ['invalid consumed string', withTasks([makeTask('bad', 'failed', { model: 'gpt-image-2', params: { outputFormat: 4 } })])],
    ['missing consumed thinking', withTasks([makeTask('bad', 'failed', { backend: 'nanobanana', model: 'gemini-3-pro-image' })])],
  ] as const)('leaves a %s manifest unreadable without repairing or rewriting it', async (_case, tasks) => {
    const id = '20260115-000000-utc'
    const dir = stageSession(id, { tasks: tasks as Record<BackendId, Task[]> })
    const bytes = fs.readFileSync(path.join(dir, 'session.json'))
    expect((await listSessions())).toContainEqual({ sessionId: id, unopenable: 'unreadable' })
    await expect(resumeSession(id)).rejects.toThrow(/missing a readable session.json/)
    expect(fs.readFileSync(path.join(dir, 'session.json'))).toEqual(bytes)
  })

  it('retains missing optional task fields and unlisted-model plain request parameters', async () => {
    const task: Partial<Task> = makeTask('failed', 'failed', { model: 'unlisted', params: { thinking: {}, width: 'provider-owned' } })
    delete task.startedAt
    delete task.completedAt
    delete task.durationMs
    delete task.imagePath
    delete task.baseName
    delete task.error
    delete task.providerMessage
    const id = '20260115-000000-utc'
    stageSession(id, { tasks: withTasks([task as Task]) })
    await resumeSession(id)
    expect(queueManager.getTask('openai', 'failed')).toMatchObject({ id: 'failed', status: 'failed', params: task.params })
  })
})

describe('governing session manifest mutation admission', () => {
  it.each([false, true])('returns committed removal and the exact remaining metadata after partial file cleanup (Trash: %s)', async (toTrash) => {
    settings.deleteToTrash = toTrash
    const dir = getSessionDir()
    const image = path.join(dir, 'partial.png')
    const sidecar = path.join(dir, 'partial.json')
    fs.writeFileSync(image, 'image')
    fs.writeFileSync(sidecar, JSON.stringify({ format_version: FORMAT_VERSIONS.imageSidecar }))
    queueManager.replaceAllTasks(withTasks([makeTask('partial', 'completed', { baseName: 'partial', imagePath: image })]))
    await persistActiveSession()
    const hostile = new Error('EACCES /private/staging SECRET_SENTINEL')
    if (toTrash) trashItem.mockImplementation(async (file) => {
      if (file === sidecar) throw hostile
      fs.unlinkSync(file)
    })
    else {
      const unlink = fs.promises.rm
      vi.spyOn(fs.promises, 'rm').mockImplementation(async (file, options) => {
        if (file === sidecar) throw hostile
        return unlink(file, options)
      })
    }
    const result = await handlers.get('queue:deleteWithFiles')!({}, 'openai', 'partial')
    expect(result).toEqual({ removed: true, sessionId: getSessionId(), baseName: 'partial', ext: 'png', files: { image: 'removed', metadata: 'remaining' } })
    expect((await readManifest(dir)).tasks.openai).toEqual([])
    expect(fs.existsSync(image)).toBe(false)
    expect(fs.existsSync(sidecar)).toBe(true)
    expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL')
  })

  it.each([false, true])('refuses Delete after listing when the governing manifest becomes newer (Trash: %s)', async (toTrash) => {
    settings.deleteToTrash = toTrash
    const id = '20260115-000000-utc'
    const dir = stageSession(id)
    expect((await listSessions())).toContainEqual(expect.objectContaining({ sessionId: id, isCurrent: false }))
    stageSession(id, { formatVersion: FORMAT_VERSIONS.session + 1 })
    const bytes = fs.readFileSync(path.join(dir, 'session.json'))
    await expect(deleteSession(id)).rejects.toMatchObject({ name: 'NewerFormatError', path: path.join(dir, 'session.json') })
    expect(fs.readFileSync(path.join(dir, 'session.json'))).toEqual(bytes)
    expect(trashItem).not.toHaveBeenCalled()
  })

  it.each(['missing', 'unreadable'] as const)('preserves a folder whose governing manifest is %s', async (problem) => {
    const id = '20260115-000000-utc'
    const dir = stageSession(id)
    const file = path.join(dir, 'session.json')
    if (problem === 'missing') fs.unlinkSync(file)
    else fs.writeFileSync(file, '{ invalid')
    await expect(deleteSession(id)).rejects.toBeInstanceOf(StoreLeftInPlaceError)
    expect(fs.existsSync(dir)).toBe(true)
    if (problem === 'unreadable') expect(fs.readFileSync(file, 'utf8')).toBe('{ invalid')
  })

  it.each([false, true])('removes the task and both its files whatever its sidecar holds (Trash: %s)', async (toTrash) => {
    settings.deleteToTrash = toTrash
    if (toTrash) trashItem.mockImplementation(async (file) => { fs.unlinkSync(file) })
    const dir = getSessionDir()
    const image = path.join(dir, 'later.png')
    const sidecar = path.join(dir, 'later.json')
    fs.writeFileSync(image, 'image')
    fs.writeFileSync(sidecar, JSON.stringify({ format_version: FORMAT_VERSIONS.imageSidecar + 1 }))
    queueManager.replaceAllTasks(withTasks([makeTask('later', 'completed', { baseName: 'later', imagePath: image })]))
    await persistActiveSession()
    const result = await handlers.get('queue:deleteWithFiles')!({}, 'openai', 'later')
    expect(result).toEqual({ removed: true, sessionId: getSessionId(), baseName: 'later', ext: 'png' })
    expect((await readManifest(dir)).tasks.openai).toEqual([])
    expect(fs.existsSync(image)).toBe(false)
    expect(fs.existsSync(sidecar)).toBe(false)
  })
})

describe('the manifest format version', () => {
  it('lists a manifest with no format version as unreadable and leaves it as it was', async () => {
    const dir = stageSession('20260110-000000-utc', { formatVersion: undefined })
    const before = fs.readFileSync(path.join(dir, 'session.json'))

    expect((await listSessions())).toContainEqual({ sessionId: '20260110-000000-utc', unopenable: 'unreadable' })
    await expect(resumeSession('20260110-000000-utc')).rejects.toThrow(/missing a readable session.json/)
    expect(fs.readFileSync(path.join(dir, 'session.json')).equals(before)).toBe(true)
  })

  // Sessions are transient work, so their manifests keep no backup history.
  it('records nothing in the backup history when a session is saved', async () => {
    recordBackup.mockClear()
    await persistActiveSession()
    expect(fs.existsSync(path.join(getSessionDir(), 'session.json'))).toBe(true)
    expect(recordBackup).not.toHaveBeenCalled()
  })

  it('reads back the version it writes', async () => {
    await persistActiveSession()

    expect(readCheckpoint(getSessionDir()).formatVersion).toBe(FORMAT_VERSIONS.session)
    expect((await listSessions()).map((summary) => summary.sessionId)).toEqual([getSessionId()])
  })

  it('lists a manifest from a newer version as unopenable, refuses to open it, and leaves its bytes as they were', async () => {
    const dir = stageSession('20260111-000000-utc', { formatVersion: FORMAT_VERSIONS.session + 1 })
    const before = fs.readFileSync(path.join(dir, 'session.json'))

    expect((await listSessions()).map((summary) => summary.sessionId)).toEqual([getSessionId(), '20260111-000000-utc'])
    expect(log).toHaveBeenCalledWith('warn', 'Ignoring a session manifest from a newer version', expect.objectContaining({
      error: expect.stringContaining(NewerFormatError.name),
    }))
    await expect(resumeSession('20260111-000000-utc')).rejects.toThrow(/missing a readable session.json/)

    expect(fs.readFileSync(path.join(dir, 'session.json')).equals(before)).toBe(true)
  })
})


describe('physical session write ownership', () => {
  it('orders immutable submissions and active-session listing behind physical saves', async () => {
    const dir = getSessionDir()
    const rename = fs.promises.rename
    let release!: () => void
    let entered!: () => void
    const reached = new Promise<void>((resolve) => { entered = resolve })
    let first = true
    const physicalRename = vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (first && to === path.join(dir, 'session.json')) {
        first = false
        entered()
        await new Promise<void>((resolve) => { release = resolve })
      }
      return rename(from, to)
    })
    queueManager.replaceAllTasks(withTasks([makeTask('first', 'queued')]))
    const oldSave = persistActiveSession()
    await reached
    queueManager.replaceAllTasks(withTasks([makeTask('latest', 'queued')]))
    const newSave = persistActiveSession()
    const listing = listSessions()
    try {
      expect((await readManifest(dir)).tasks.openai).toEqual([])
    } finally {
      release()
      try {
        await oldSave
        await newSave
      } finally { physicalRename.mockRestore() }
    }
    expect((await listing).some((entry) => entry.sessionId === getSessionId())).toBe(true)
    expect((await readManifest(dir)).tasks.openai.map((task) => task.id)).toEqual(['latest'])
  })
})


describe('recovering published output before resume normalization', () => {
  const bytes = Buffer.from('already validated provider image bytes')
  const pendingOutput = () => ({ baseName: '20260102-030405-utc-delivered-openai', ext: 'png' as const, sha256: crypto.createHash('sha256').update(bytes).digest('hex') })
  const id = '20260125-000000-utc'

  it('adopts matching final bytes without a sidecar and durably clears pending evidence', async () => {
    const pending = pendingOutput()
    const target = stageSession(id, { tasks: withTasks([makeTask('paid', 'generating', {
      pendingOutput: pending, error: { key: 'taskFailure.notSaved' }, providerMessage: 'old diagnostic',
      completedAt: '2026-01-25T00:00:03.000Z',
    })]) })
    const image = path.join(target, `${pending.baseName}.${pending.ext}`)
    fs.writeFileSync(image, bytes)
    await resumeSession(id)
    const recovered = queueManager.getTask('openai', 'paid')!
    expect(recovered).toMatchObject({ status: 'completed', baseName: pending.baseName, imagePath: `${pending.baseName}.png`, error: null, providerMessage: null })
    expect(recovered.pendingOutput).toBeUndefined()
    expect((await readManifest(target)).tasks.openai[0]).toMatchObject({ status: 'completed', baseName: pending.baseName, imagePath: `${pending.baseName}.png`, error: null })
    expect((await readManifest(target)).tasks.openai[0].pendingOutput).toBeUndefined()
    expect(fs.existsSync(path.join(target, `${pending.baseName}.json`))).toBe(false)
    expect(fs.readFileSync(image)).toEqual(bytes)
    expect(sent('session:interruptedTasks')).toEqual([])
  })

  it('retains the exact stage association through resume and publishes only on explicit Retry', async () => {
    const pending = { ...pendingOutput(), stageName: 'known-delivered-stage.tmp' }
    const target = stageSession(id, { tasks: withTasks([makeTask('paid', 'generating', { pendingOutput: pending })]) })
    fs.writeFileSync(path.join(target, pending.stageName), bytes)
    await resumeSession(id)
    expect((await readManifest(target)).tasks.openai[0]).toMatchObject({ status: 'interrupted', pendingOutput: pending })
    expect(fs.existsSync(path.join(target, `${pending.baseName}.png`))).toBe(false)
    await handlers.get('queue:retryTask')!({}, 'openai', 'paid')
    expect((await readManifest(target)).tasks.openai[0]).toMatchObject({ status: 'completed', imagePath: `${pending.baseName}.png` })
    expect(fs.readFileSync(path.join(target, `${pending.baseName}.png`))).toEqual(bytes)
  })

  it.each(['foreign bytes', 'missing final', 'directory'] as const)('keeps interrupted work and evidence when the final is %s', async problem => {
    const pending = pendingOutput()
    const target = stageSession(id, { tasks: withTasks([makeTask('paid', 'generating', { pendingOutput: pending })]) })
    const image = path.join(target, `${pending.baseName}.${pending.ext}`)
    if (problem === 'foreign bytes') fs.writeFileSync(image, 'foreign winner')
    if (problem === 'directory') fs.mkdirSync(image)
    await resumeSession(id)
    expect(queueManager.getTask('openai', 'paid')).toMatchObject({ status: 'interrupted', imagePath: null, baseName: null, pendingOutput: pending })
    expect((await readManifest(target)).tasks.openai[0]).toMatchObject({ status: 'interrupted', pendingOutput: pending })
    expect(sent('session:interruptedTasks')).toEqual([{ count: 1 }])
    if (problem === 'foreign bytes') expect(fs.readFileSync(image, 'utf8')).toBe('foreign winner')
    if (problem === 'missing final') expect(fs.existsSync(image)).toBe(false)
    if (problem === 'directory') expect(fs.statSync(image).isDirectory()).toBe(true)
  })

  it.skipIf(process.platform === 'win32')('does not adopt a symlink even when its destination has the expected bytes', async () => {
    const pending = pendingOutput()
    const target = stageSession(id, { tasks: withTasks([makeTask('paid', 'generating', { pendingOutput: pending })]) })
    const original = path.join(target, 'other-file.png')
    const image = path.join(target, `${pending.baseName}.${pending.ext}`)
    fs.writeFileSync(original, bytes)
    fs.symlinkSync(original, image)
    await resumeSession(id)
    expect(queueManager.getTask('openai', 'paid')).toMatchObject({ status: 'interrupted', pendingOutput: pending })
    expect(fs.lstatSync(image).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(original)).toEqual(bytes)
  })

  it.each([
    null, [],
    { baseName: '../outside', ext: 'png', sha256: 'a'.repeat(64) },
    { baseName: 'unsafe\\path', ext: 'png', sha256: 'a'.repeat(64) },
    { baseName: 'safe', ext: 'svg', sha256: 'a'.repeat(64) },
    { baseName: 'safe', ext: 'png', sha256: 'A'.repeat(64) },
    { baseName: 'safe', ext: 'png', sha256: 'a'.repeat(63) },
    { baseName: 'safe', ext: 'png', sha256: 'a'.repeat(64), stageName: '../escape.tmp' },
    { baseName: 'safe', ext: 'png', sha256: 'a'.repeat(64), stageName: 'session.json' },
  ])('leaves malformed pending evidence unreadable and all bytes untouched: %j', async pending => {
    const task = makeTask('paid', 'generating', { pendingOutput: pending as unknown as Task['pendingOutput'] })
    const target = stageSession(id, { tasks: withTasks([task]) })
    const image = path.join(target, 'safe.png')
    fs.writeFileSync(image, bytes)
    const manifest = fs.readFileSync(path.join(target, 'session.json'))
    const current = getSessionDir()
    expect(await listSessions()).toContainEqual({ sessionId: id, unopenable: 'unreadable' })
    await expect(resumeSession(id)).rejects.toThrow('missing a readable session.json')
    expect(getSessionDir()).toBe(current)
    expect(fs.readFileSync(path.join(target, 'session.json'))).toEqual(manifest)
    expect(fs.readFileSync(image)).toEqual(bytes)
  })

  it.each(['EACCES', 'EIO'])('refuses to adopt a session when inspecting paid output fails with %s', async code => {
    const pending = pendingOutput()
    const target = stageSession(id, { tasks: withTasks([makeTask('paid', 'generating', { pendingOutput: pending })]) })
    const image = path.join(target, `${pending.baseName}.${pending.ext}`)
    fs.writeFileSync(image, bytes)
    const original = fs.readFileSync(path.join(target, 'session.json'))
    const current = getSessionDir()
    const inspect = fs.promises.lstat.bind(fs.promises)
    const failed = vi.spyOn(fs.promises, 'lstat').mockImplementation((...args) => {
      if (String(args[0]) === image) return Promise.reject(Object.assign(new Error('storage unavailable'), { code }))
      return inspect(...args)
    })
    try {
      await expect(resumeSession(id)).rejects.toMatchObject({ code })
      expect(getSessionDir()).toBe(current)
      expect(queueManager.getTask('openai', 'paid')).toBeUndefined()
      expect(sent('session:changed')).toEqual([])
      expect(fs.readFileSync(path.join(target, 'session.json'))).toEqual(original)
      expect(fs.readFileSync(image)).toEqual(bytes)
    } finally { failed.mockRestore() }
  })

  it('reads a version-one manifest unchanged before applying ordinary resume normalization', async () => {
    const target = stageSession(id, { formatVersion: 1, tasks: withTasks([makeTask('old', 'queued')]) })
    const original = fs.readFileSync(path.join(target, 'session.json'))
    expect(await listSessions()).toContainEqual(expect.objectContaining({ sessionId: id, isCurrent: false }))
    expect(fs.readFileSync(path.join(target, 'session.json'))).toEqual(original)
    await resumeSession(id)
    expect(queueManager.getTask('openai', 'old')?.status).toBe('interrupted')
    expect(readCheckpoint(target).formatVersion).toBe(FORMAT_VERSIONS.session)
  })
})


describe('session journal admission and active read ordering', () => {
  it.each([
    { pendingOutput: { baseName: '../outside', ext: 'png', sha256: 'a'.repeat(64) } },
    { error: { key: 'taskFailure.generic', values: { name: false } } },
  ])('refuses a complete journal row with malformed nested task data and leaves both files untouched: %j', async malformed => {
    const id = '20260127-000000-utc'
    const target = stageSession(id, { journalSequence: 0, tasks: withTasks([makeTask('queued', 'queued')]) })
    const checkpoint = path.join(target, 'session.json')
    const journal = path.join(target, journalFile.JOURNAL_FILENAME)
    const invalid = { ...makeTask('queued', 'generating'), ...malformed }
    fs.writeFileSync(journal, JSON.stringify({ sequence: 1, updatedAt: '2026-01-27T00:00:01.000Z', upserts: [invalid], removed: [] }) + '\n')
    const before = [checkpoint, journal].map(file => fs.readFileSync(file))
    const current = getSessionDir()
    expect(await listSessions()).toContainEqual({ sessionId: id, unopenable: 'unreadable' })
    await expect(resumeSession(id)).rejects.toThrow('missing a readable session.json')
    expect(getSessionDir()).toBe(current)
    expect([checkpoint, journal].map(file => fs.readFileSync(file))).toEqual(before)
  })

  it('replays pending publication evidence before recovering matching output without a sidecar', async () => {
    const id = '20260128-000000-utc'
    const target = stageSession(id, { journalSequence: 0, tasks: withTasks([makeTask('paid', 'queued')]) })
    const bytes = Buffer.from('delivered validated image retained across journal recovery')
    const pendingOutput = { baseName: '20260128-010203-utc-paid-openai', ext: 'png' as const, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
    const image = path.join(target, `${pendingOutput.baseName}.png`)
    fs.writeFileSync(image, bytes)
    fs.writeFileSync(path.join(target, journalFile.JOURNAL_FILENAME), JSON.stringify({
      sequence: 1, updatedAt: '2026-01-28T01:02:03.000Z',
      upserts: [makeTask('paid', 'generating', { pendingOutput, completedAt: '2026-01-28T01:02:03.000Z' })], removed: [],
    }) + '\n')
    expect(readCheckpoint(target).tasks.openai[0].status).toBe('queued')
    await resumeSession(id)
    expect(queueManager.getTask('openai', 'paid')).toMatchObject({ status: 'completed', baseName: pendingOutput.baseName, imagePath: `${pendingOutput.baseName}.png`, error: null })
    expect(queueManager.getTask('openai', 'paid')?.pendingOutput).toBeUndefined()
    expect((await readManifest(target)).tasks.openai[0]).toMatchObject({ status: 'completed', imagePath: `${pendingOutput.baseName}.png` })
    expect((await readManifest(target)).tasks.openai[0].pendingOutput).toBeUndefined()
    expect(fs.existsSync(path.join(target, `${pendingOutput.baseName}.json`))).toBe(false)
    expect(fs.readFileSync(image)).toEqual(bytes)
    expect(sent('session:interruptedTasks')).toEqual([])
  })

  it('holds active-session listing behind an append and reports the resulting saved counts', async () => {
    const tasks = Array.from({ length: 20 }, (_, index) => makeTask(`completed-${index}`, 'completed'))
    queueManager.replaceAllTasks(withTasks(tasks))
    await persistActiveSession()
    const current = getSessionDir()
    const append = journalFile.appendSessionTransition
    let release!: () => void
    let entered!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const writing = new Promise<void>(resolve => { entered = resolve })
    const physicalAppend = vi.spyOn(journalFile, 'appendSessionTransition').mockImplementationOnce(async (...args) => {
      entered()
      await held
      return append(...args)
    })
    queueManager.updateTask(queueManager.getTask('openai', 'completed-0')!, { status: 'failed' })
    const saved = persistActiveSession()
    await writing
    const directoryRead = vi.spyOn(fs.promises, 'readdir')
    const checkpointRead = vi.spyOn(fs.promises, 'readFile')
    let settled = false
    const listing = listSessions().then(result => { settled = true; return result })
    try {
      // Flush promise continuations: the whole listing must wait on the
      // held writer before even enumerating session directories.
      await Promise.resolve()
      await Promise.resolve()
      expect(settled).toBe(false)
      expect(directoryRead).not.toHaveBeenCalled()
      expect(checkpointRead.mock.calls.some(([file]) => file === path.join(current, 'session.json'))).toBe(false)
      release()
      await saved
      const rows = await listing
      expect(rows).toContainEqual(expect.objectContaining({
        sessionId: getSessionId(), isCurrent: true, completedCount: 19,
        taskCounts: expect.objectContaining({ total: 20, completed: 19, failed: 1 }),
      }))
      expect(settled).toBe(true)
      expect(physicalAppend).toHaveBeenCalledOnce()
    } finally {
      release()
      await Promise.allSettled([saved, listing])
      checkpointRead.mockRestore()
      directoryRead.mockRestore()
      physicalAppend.mockRestore()
    }
  })
})


it('keeps a listing behind incoming session adoption while its checkpoint is held', async () => {
  const id = '20260129-000000-utc'
  const target = stageSession(id, { journalSequence: 0, tasks: withTasks([makeTask('incoming', 'queued')]) })
  fs.writeFileSync(path.join(target, journalFile.JOURNAL_FILENAME), JSON.stringify({
    sequence: 1, updatedAt: '2026-01-29T00:00:01.000Z',
    upserts: [makeTask('incoming', 'completed')], removed: [],
  }) + '\n')
  const outgoing = getSessionId()
  const rename = fs.promises.rename.bind(fs.promises)
  let release!: () => void
  let entered!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const writing = new Promise<void>(resolve => { entered = resolve })
  const checkpoint = vi.spyOn(fs.promises, 'rename').mockImplementation(async (...args) => {
    if (String(args[1]) === path.join(target, 'session.json')) {
      entered()
      await held
    }
    return rename(...args)
  })
  const resuming = resumeSession(id)
  await writing
  const directoryRead = vi.spyOn(fs.promises, 'readdir')
  const checkpointRead = vi.spyOn(fs.promises, 'readFile')
  let settled = false
  const listing = listSessions().then(rows => { settled = true; return rows })
  try {
    await Promise.resolve()
    await Promise.resolve()
    expect(getSessionId()).toBe(outgoing)
    expect(settled).toBe(false)
    expect(directoryRead).not.toHaveBeenCalled()
    expect(checkpointRead).not.toHaveBeenCalled()
    release()
    await resuming
    const rows = await listing
    expect(getSessionId()).toBe(id)
    expect(rows).toContainEqual(expect.objectContaining({
      sessionId: id, isCurrent: true, completedCount: 1,
      taskCounts: expect.objectContaining({ total: 1, queued: 0, completed: 1 }),
    }))
    expect(readCheckpoint(target).journalSequence).toBe(1)
    expect(readCheckpoint(target).tasks.openai[0].status).toBe('completed')
  } finally {
    release()
    await Promise.allSettled([resuming, listing])
    checkpointRead.mockRestore()
    directoryRead.mockRestore()
    checkpoint.mockRestore()
  }
})

it('persists active output while an unrelated archived manifest read is held', async () => {
  const current = getSessionDir()
  const archive = stageSession('20260201-000000-utc')
  const originalRead = fs.promises.readFile.bind(fs.promises)
  let release!: () => void
  let entered!: () => void
  const reached = new Promise<void>(resolve => { entered = resolve })
  const held = new Promise<void>(resolve => { release = resolve })
  const reader = vi.spyOn(fs.promises, 'readFile').mockImplementation(async (...args) => {
    if (String(args[0]) === path.join(archive, 'session.json')) { entered(); await held }
    return originalRead(...args)
  })
  const listing = listSessions()
  await reached
  try {
    queueManager.enqueue({ backend: 'openai', model: 'm', prompt: 'new work', params: {}, count: 1 })
    await persistActiveSession()
    expect((await readManifest(current)).tasks.openai).toHaveLength(1)
  } finally {
    release()
    await listing
    reader.mockRestore()
  }
})

it.each(['resume', 'delete'] as const)('waits only for the affected archive read before %s', async action => {
  const id = '20260202-000000-utc'
  const archive = stageSession(id, { tasks: withTasks([makeTask('retained', 'completed')]) })
  const outgoing = getSessionId()
  const originalRead = fs.promises.readFile.bind(fs.promises)
  let release!: () => void
  let entered!: () => void
  const reached = new Promise<void>(resolve => { entered = resolve })
  const held = new Promise<void>(resolve => { release = resolve })
  let first = true
  const reader = vi.spyOn(fs.promises, 'readFile').mockImplementation(async (...args) => {
    if (first && String(args[0]) === path.join(archive, 'session.json')) { first = false; entered(); await held }
    return originalRead(...args)
  })
  const listing = listSessions()
  await reached
  let settled = false
  const mutation = (action === 'resume' ? resumeSession(id) : deleteSession(id)).then(() => { settled = true })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(settled).toBe(false)
    expect(getSessionId()).toBe(outgoing)
    expect(fs.existsSync(archive)).toBe(true)
    release()
    await Promise.all([listing, mutation])
    if (action === 'resume') expect(getSessionId()).toBe(id)
    else expect(fs.existsSync(archive)).toBe(false)
  } finally {
    release()
    await Promise.allSettled([listing, mutation])
    reader.mockRestore()
  }
})

it('coalesces concurrent start saves at the confirmed journal revision', async () => {
  queueManager.replaceAllTasks(withTasks(Array.from({ length: 20 }, (_, index) => makeTask(`start-${index}`, 'queued'))))
  await persistActiveSession()
  const append = vi.spyOn(journalFile, 'appendSessionTransition')
  queueManager.updateTask(queueManager.getTask('openai', 'start-0')!, { status: 'generating' })
  queueManager.updateTask(queueManager.getTask('openai', 'start-1')!, { status: 'generating' })
  await Promise.all([persistActiveSession(), persistActiveSession()])
  expect(append).toHaveBeenCalledOnce()
  expect((await readManifest(getSessionDir())).tasks.openai.filter(task => task.status === 'generating')).toHaveLength(2)
  append.mockRestore()
})

it('keeps the outgoing session adopted until its new sibling directory is durable', async () => {
  const original = sync.syncDirectoryAsync
  const outgoing = getSessionDir()
  let reject!: (error: Error) => void
  let entered!: () => void
  const reached = new Promise<void>(resolve => { entered = resolve })
  const held = new Promise<void>((_resolve, fail) => { reject = fail })
  const parent = vi.spyOn(sync, 'syncDirectoryAsync').mockImplementation(async directory => {
    if (directory === getSessionsDir()) { entered(); await held }
    else await original(directory)
  })
  const creation = createSession()
  const rejected = expect(creation).rejects.toThrow('parent sync failed')
  await reached
  try {
    expect(getSessionDir()).toBe(outgoing)
    expect(sent('session:changed')).toEqual([])
    reject(new Error('parent sync failed'))
    await rejected
    expect(getSessionDir()).toBe(outgoing)
    expect(sent('session:changed')).toEqual([])
    expect(fs.readdirSync(getSessionsDir())).toEqual([path.basename(outgoing)])
  } finally {
    reject(new Error('parent sync failed'))
    await Promise.allSettled([creation])
    parent.mockRestore()
  }
})


describe('active session summary', () => {
  it('reads the active snapshot including kept images without archive or manifest I/O', async () => {
    await createSession()
    stageSession('archive')
    queueManager.replaceAllTasks(withTasks([
      makeTask('done', 'completed'), makeTask('kept', 'kept'), makeTask('retry', 'interrupted'),
    ]))
    await persistActiveSession()
    const read = vi.spyOn(fs.promises, 'readFile')
    const directories = vi.spyOn(fs.promises, 'readdir')
    try {
      const summary = await getActiveSessionSummary()
      expect(summary).toMatchObject({ sessionId: getSessionId(), isCurrent: true,
        completedCount: 1, keptCount: 1, retryCount: 1, taskCounts: { total: 3 },
        thumbnails: [{ baseName: 'base-done' }],
      })
      expect(summary.updatedAt).toBeTruthy()
      expect(read).not.toHaveBeenCalled()
      expect(directories).not.toHaveBeenCalled()
    } finally { read.mockRestore(); directories.mockRestore() }
  })
})
