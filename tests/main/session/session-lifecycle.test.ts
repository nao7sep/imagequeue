import fs from 'fs'
import path from 'path'
import os from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BackendId, SessionManifest, Task, TaskStatus } from '../../../src/shared/types'

// Sessions are folders of the user's generated images with a manifest beside
// them, so these paths are exercised against a real output directory: what the
// manifest says, which folder is current, and — for the drop/delete paths —
// whether a folder is really gone. Only Electron, the config file, the log sink
// and the renderer publisher are substituted.
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
vi.mock('../../../src/main/logger', () => ({ log, serializeError: (error: unknown) => String(error) }))

const publishQueueState = vi.hoisted(() => vi.fn())
vi.mock('../../../src/main/queue/publisher', () => ({ publishQueueState }))

const {
  createSession,
  deleteSession,
  dropCurrentSessionIfEmpty,
  drainPendingDraftWrites,
  getActiveSessionDraft,
  appendActiveSessionElaboratedPrompts,
  clearActiveSessionElaboratedPrompts,
  deleteActiveSessionElaboratedPromptAt,
  getActiveSessionElaboratedPrompts,
  listSessions,
  persistActiveSession,
  resumeSession,
  setActiveSessionDraft,
} = await import('../../../src/main/session/state')
const { getOutputDir, getSessionDir, getSessionId, setSessionDir } = await import('../../../src/main/session/session')
const { createEmptyQueues, queueManager } = await import('../../../src/main/queue/queue-manager')
const { createEmptySessionDraft } = await import('../../../src/shared/session-draft')
const { SESSION_MANIFEST_VERSION } = await import('../../../src/shared/types')

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
    ...extra,
  }
}

function withTasks(tasks: Task[]): Record<BackendId, Task[]> {
  const queues = createEmptyQueues()
  for (const task of tasks) queues[task.backend].push(task)
  return queues
}

function readManifest(sessionDir: string): SessionManifest {
  return JSON.parse(fs.readFileSync(path.join(sessionDir, 'session.json'), 'utf-8')) as SessionManifest
}

/** A session folder on disk that this process never opened. */
function stageSession(sessionId: string, manifest: Partial<SessionManifest> = {}): string {
  const dir = path.join(getOutputDir(), sessionId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'session.json'),
    JSON.stringify({
      version: SESSION_MANIFEST_VERSION,
      sessionId,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastResumedAt: null,
      taskCounts: { total: 0, queued: 0, generating: 0, completed: 0, failed: 0, interrupted: 0, kept: 0 },
      elaboratedPrompts: [],
      draft: createEmptySessionDraft(),
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
  setSessionDir(path.join(getOutputDir(), '20260101-000000-utc'))
  queueManager.replaceAllTasks(createEmptyQueues())
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
  it('opens a fresh folder with an empty manifest and tells the window', async () => {
    const previous = getSessionDir()
    queueManager.replaceAllTasks(withTasks([makeTask('a', 'completed')]))

    await createSession()

    expect(getSessionDir()).not.toBe(previous)
    const manifest = readManifest(getSessionDir())
    expect(manifest).toMatchObject({
      version: SESSION_MANIFEST_VERSION,
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

    expect(readManifest(previous).tasks.openai.map((task) => task.id)).toEqual(['a', 'b'])
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
  it('reports each readable session, newest first, and marks the open one', () => {
    stageSession('20260102-000000-utc', { updatedAt: '2026-01-02T00:00:00.000Z' })
    stageSession('20260103-000000-utc', {
      updatedAt: '2026-01-03T00:00:00.000Z',
      tasks: withTasks([makeTask('a', 'completed'), makeTask('b', 'kept'), makeTask('c', 'failed')]),
    })

    const summaries = listSessions()

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
    const copy = path.join(getOutputDir(), '20260106-000000-utc copy')
    fs.cpSync(original, copy, { recursive: true })

    const ids = listSessions().map((summary) => summary.sessionId)
    expect(ids).toContain('20260106-000000-utc')
    expect(ids).toContain('20260106-000000-utc copy')

    await deleteSession('20260106-000000-utc copy')
    expect(fs.existsSync(copy)).toBe(false)
    expect(fs.existsSync(original), 'the original survives deleting its copy').toBe(true)
  })

  it('passes over a folder with no manifest and one it cannot read', () => {
    fs.mkdirSync(path.join(getOutputDir(), 'not-a-session'), { recursive: true })
    const broken = path.join(getOutputDir(), '20260104-000000-utc')
    fs.mkdirSync(broken, { recursive: true })
    fs.writeFileSync(path.join(broken, 'session.json'), '{ not json', 'utf-8')

    expect(listSessions().map((summary) => summary.sessionId)).toEqual([getSessionId()])
    expect(log).toHaveBeenCalledWith('warn', 'Ignoring unreadable session manifest', expect.anything())
  })
})

describe('resuming a session', () => {
  it('loads its work, marks what never finished, and says how much was interrupted', async () => {
    const staged = stageSession('20260105-000000-utc', {
      tasks: withTasks([makeTask('done', 'completed'), makeTask('midway', 'generating'), makeTask('waiting', 'queued')]),
    })

    await resumeSession('20260105-000000-utc')

    expect(getSessionDir()).toBe(staged)
    const resumed = queueManager.getAllStoredTasks().openai
    expect(resumed.map((task) => [task.id, task.status])).toEqual([
      ['done', 'completed'],
      ['midway', 'interrupted'],
      ['waiting', 'interrupted'],
    ])
    expect(sent('session:changed')).toEqual([{ sessionId: '20260105-000000-utc' }])
    expect(sent('session:interruptedTasks')).toEqual([{ count: 2 }])
    expect(readManifest(staged).lastResumedAt, 'the resume is stamped on disk').not.toBeNull()
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
    fs.mkdirSync(path.join(getOutputDir(), '20260107-000000-utc'), { recursive: true })

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
    await expect(deleteSession('20260113-000000-utc')).rejects.toThrow(/no longer exists/)
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
  it('normalizes what the renderer sends and writes it through on a drain', () => {
    setActiveSessionDraft({ ...createEmptySessionDraft(), prompt: 'a cat', count: -5 })

    expect(getActiveSessionDraft().prompt).toBe('a cat')
    expect(getActiveSessionDraft().count, 'a nonsense count is repaired').toBeGreaterThan(0)
    expect(readManifest(getSessionDir()).draft.prompt, 'not yet, the write is coalesced').toBe('')

    drainPendingDraftWrites()

    expect(readManifest(getSessionDir()).draft.prompt).toBe('a cat')
  })

  it('restores the draft and the prompts when the session is opened again', async () => {
    setActiveSessionDraft({ ...createEmptySessionDraft(), prompt: 'a cat on a shelf' })
    appendActiveSessionElaboratedPrompts([{ text: 'a cat on a sunlit shelf', concepts: [] }])
    const sessionId = getSessionId()
    await createSession()

    await resumeSession(sessionId)

    expect(getActiveSessionDraft().prompt).toBe('a cat on a shelf')
    expect(getActiveSessionElaboratedPrompts()).toEqual([{ text: 'a cat on a sunlit shelf', concepts: [] }])
  })

  it('persists every change to the elaborated list', () => {
    appendActiveSessionElaboratedPrompts([
      { text: 'first', concepts: [] },
      { text: 'second', concepts: [] },
    ])
    expect(readManifest(getSessionDir()).elaboratedPrompts.map((entry) => entry.text)).toEqual(['first', 'second'])

    expect(deleteActiveSessionElaboratedPromptAt(0).map((entry) => entry.text)).toEqual(['second'])
    expect(readManifest(getSessionDir()).elaboratedPrompts.map((entry) => entry.text)).toEqual(['second'])

    expect(deleteActiveSessionElaboratedPromptAt(7), 'an index that is not there changes nothing').toHaveLength(1)
    expect(appendActiveSessionElaboratedPrompts([]), 'appending nothing changes nothing').toHaveLength(1)

    expect(clearActiveSessionElaboratedPrompts()).toEqual([])
    expect(readManifest(getSessionDir()).elaboratedPrompts).toEqual([])
  })

  it('stamps every manifest write with the moment it happened', () => {
    const before = readManifest(getSessionDir()).updatedAt

    const manifest = persistActiveSession()

    expect(manifest.updatedAt >= before).toBe(true)
    expect(readManifest(getSessionDir()).updatedAt).toBe(manifest.updatedAt)
  })
})
