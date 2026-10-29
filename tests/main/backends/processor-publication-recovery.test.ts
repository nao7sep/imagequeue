import { tinyPng } from '../image-fixture'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AppConfig } from '../../../src/main/config/types'
import type { SessionManifest } from '../../../src/shared/types'
import { createDefaultConfig } from '../../../src/main/config/defaults'

// Keep the processor, queue, session writer and output publication real. Only
// providers, native presentation and the optional diagnostic sinks are faked.
const fixture = vi.hoisted(() => ({ root: '', config: null as AppConfig | null, nextSession: Date.UTC(2026, 0, 1) }))
const generate = vi.hoisted(() => vi.fn())
const send = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ webContents: { send } }] },
  shell: { trashItem: vi.fn() },
}))
vi.mock('../../../src/main/config', () => ({
  getDataDir: () => fixture.root,
  loadConfig: () => fixture.config!,
}))
vi.mock('../../../src/main/main-window-layout', () => ({ refreshMainWindowMinimumSize: () => undefined }))
vi.mock('../../../src/main/logger', () => ({
  log: vi.fn(), logGenerationStart: vi.fn(), logGenerationComplete: vi.fn(), logGenerationFailed: vi.fn(),
  serializeError: (error: unknown) => String(error),
}))
vi.mock('../../../src/main/backup/backup-store', () => ({ record: vi.fn() }))
vi.mock('../../../src/main/backends/openai', () => ({ generateOpenAI: generate }))
vi.mock('../../../src/main/backends/nanobanana', () => ({ generateNanoBanana: generate }))
vi.mock('../../../src/main/backends/grok', () => ({ generateGrok: generate }))
vi.mock('../../../src/main/backends/flux', () => ({ generateFlux: generate }))
vi.mock('../../../src/main/backends/drawthings', () => ({ generateDrawThings: generate }))
vi.mock('../../../src/main/backends/slug', () => ({ generateSlug: async () => 'delivered' }))
vi.mock('../../../src/main/session/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/session/session')>()
  return { ...actual, createSessionDir: async () => actual.createSessionDir(new Date(fixture.nextSession += 1_000)) }
})

const { processQueues } = await import('../../../src/main/backends/processor')
const { queueManager, createEmptyQueues } = await import('../../../src/main/queue/queue-manager')
const { createSession, resumeSession, persistActiveSession, drainSessionWrites, readManifestFromDir } = await import('../../../src/main/session/state')
const { getSessionDir, getSessionId, setSessionDir } = await import('../../../src/main/session/session')
const { setQueuePaused, isQueuePaused, stopAllRuns, stopGenerations, resetCancellationState } = await import('../../../src/main/backends/cancellation')

let rejectDelivery: (error: Error) => void = () => undefined

async function readManifest(dir: string) {
  const read = await readManifestFromDir(dir)
  if (!read.manifest) throw new Error(`Durable session is ${read.problem}`)
  return read.manifest
}

beforeEach(async () => {
  vi.clearAllMocks()
  fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-publication-'))
  fixture.config = createDefaultConfig()
  resetCancellationState()
  queueManager.replaceAllTasks(createEmptyQueues())
  setSessionDir(path.join(fixture.root, 'sessions', '20000101-000000-utc'))
  await createSession()
  fixture.config.general.drop_empty_sessions = false
  send.mockClear()
})

afterEach(async () => {
  rejectDelivery(new Error('test teardown'))
  await stopAllRuns()
  vi.restoreAllMocks()
  await persistActiveSession()
  resetCancellationState()
  fs.rmSync(fixture.root, { recursive: true, force: true })
})

it('warns once after a user pause and preserves delivered images through sidecar/save failure, retry and reopen', async () => {
  let deliver!: (result: { buffer: Buffer }) => void
  const delivery = new Promise<{ buffer: Buffer }>((resolve, reject) => { deliver = resolve; rejectDelivery = reject })
  let entered!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  let running = 0
  generate.mockImplementation(() => { if (++running === 2) entered(); return delivery })
  const queued = queueManager.enqueue({ backend: 'openai', model: 'gpt-image-2', prompt: 'a cat', params: {}, count: 2 })
  await persistActiveSession()
  const dir = getSessionDir(), sessionId = getSessionId()
  processQueues()
  await started
  setQueuePaused(true)
  await expect(createSession()).rejects.toThrow(/active generation/)
  await expect(resumeSession('20000101-000000-utc')).rejects.toThrow(/active generation/)

  const link = fs.promises.link.bind(fs.promises)
  const sidecarFailure = vi.spyOn(fs.promises, 'link').mockImplementation(async (source, destination) => {
    if (String(destination).endsWith('.json')) throw Object.assign(new Error('sidecar unavailable'), { code: 'EACCES' })
    return link(source, destination)
  })
  const rename = fs.promises.rename.bind(fs.promises)
  const open = fs.promises.open.bind(fs.promises)
  const recorded = new Set<string>()
  const permitPublicationEvidence = (entries: SessionManifest['tasks']['openai']): void => {
    const pending = entries.flatMap(task => task.pendingOutput ? [task.pendingOutput.baseName] : [])
    // Required pre-publication evidence may land; only the later outcome save
    // fails. An allocation snapshot may already include a sibling's completion.
    if (!pending.some(name => !recorded.has(name))) throw new Error('session unavailable')
    for (const name of pending) recorded.add(name)
  }
  const finalCheckpointFailure = vi.spyOn(fs.promises, 'rename').mockImplementation(async (source, destination) => {
    if (String(destination).endsWith('session.json')) {
      const next = JSON.parse(fs.readFileSync(source, 'utf8')) as SessionManifest
      permitPublicationEvidence(next.tasks.openai)
    }
    await rename(source, destination)
  })
  const finalJournalFailure = vi.spyOn(fs.promises, 'open').mockImplementation(async (file, flags, mode) => {
    const handle = await open(file, flags, mode)
    if (String(file).endsWith('session-changes.jsonl') && flags !== 'r') {
      const write = handle.write.bind(handle)
      vi.spyOn(handle, 'write').mockImplementation((async (...args: unknown[]) => {
        const transition = JSON.parse(Buffer.from(args[0] as Uint8Array).toString('utf8')) as { upserts: SessionManifest['tasks']['openai'] }
        permitPublicationEvidence(transition.upserts)
        return Reflect.apply(write, handle, args)
      }) as typeof handle.write)
    }
    return handle
  })
  const image = await tinyPng()
  deliver({ buffer: image })
  // Quit waits for actual publication and final-save attempts, including a
  // delivered result that wins a race with cancellation.
  expect(stopGenerations()).toBe(2)
  await stopAllRuns()

  expect(isQueuePaused()).toBe(true)
  const completed = queueManager.getAllStoredTasks().openai
  expect(completed.map((task) => task.status)).toEqual(['completed', 'completed'])
  for (const task of completed) {
    expect(fs.readFileSync(path.join(dir, task.imagePath!))).toEqual(image)
    expect(fs.existsSync(path.join(dir, `${task.baseName}.json`))).toBe(false)
  }
  expect((await readManifest(dir)).tasks.openai.some((task) => task.status === 'generating')).toBe(true)
  expect(recorded.size).toBe(2)
  await expect(drainSessionWrites()).rejects.toThrow('session unavailable')
  expect(send.mock.calls.filter(([channel]) => channel === 'app:notice').map(([, notice]) => notice)).toEqual([
    { title: { key: 'notice.queuePausedTitle' }, message: { key: 'notice.queuePausedMessage' } },
  ])

  sidecarFailure.mockRestore()
  finalCheckpointFailure.mockRestore()
  finalJournalFailure.mockRestore()
  await persistActiveSession()
  await expect(drainSessionWrites()).resolves.toBeUndefined()
  await createSession()
  await resumeSession(sessionId)
  expect(queueManager.getAllStoredTasks().openai).toEqual(completed)
  expect(new Set((await readManifest(dir)).tasks.openai.map((task) => task.id))).toEqual(new Set(queued.map((task) => task.id)))
  for (const task of completed) expect(fs.readFileSync(path.join(dir, task.imagePath!))).toEqual(image)
  setQueuePaused(false)
  processQueues()
  expect(generate).toHaveBeenCalledTimes(2)
})


it('records delivered identity before publication and recovers it after the final save is lost', async () => {
  const image = await tinyPng()
  generate.mockResolvedValue({ buffer: image })
  const [task] = queueManager.enqueue({ backend: 'openai', model: 'gpt-image-2', prompt: 'a cat', params: {}, count: 1 })
  await persistActiveSession()
  const directory = getSessionDir(), id = getSessionId()
  let durableBeforePublication: { manifest: Buffer; journal: Buffer | null } | undefined
  const link = fs.promises.link.bind(fs.promises)
  vi.spyOn(fs.promises, 'link').mockImplementation(async (source, destination) => {
    if (String(destination).endsWith('.png')) {
      const durable = await readManifest(directory)
      durableBeforePublication = {
        manifest: fs.readFileSync(path.join(directory, 'session.json')),
        journal: fs.existsSync(path.join(directory, 'session-changes.jsonl'))
          ? fs.readFileSync(path.join(directory, 'session-changes.jsonl')) : null,
      }
      expect(durable.tasks.openai[0]).toMatchObject({
        id: task.id, status: 'generating', pendingOutput: { baseName: path.basename(String(destination), '.png'), ext: 'png', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
      })
    }
    await link(source, destination)
  })
  processQueues()
  await vi.waitFor(() => expect(queueManager.getTask('openai', task.id)?.status).toBe('completed'))
  await stopAllRuns()
  const completed = queueManager.getTask('openai', task.id)!
  expect(completed.pendingOutput).toBeUndefined()
  const name = completed.baseName!
  await createSession()
  // Recreate precisely the durable state observed before the final image
  // appeared, as a crash before its outcome save would leave it.
  expect(durableBeforePublication).toBeDefined()
  fs.writeFileSync(path.join(directory, 'session.json'), durableBeforePublication!.manifest)
  if (durableBeforePublication!.journal) {
    fs.writeFileSync(path.join(directory, 'session-changes.jsonl'), durableBeforePublication!.journal)
  } else {
    fs.rmSync(path.join(directory, 'session-changes.jsonl'), { force: true })
  }
  fs.rmSync(path.join(directory, `${name}.json`))
  await resumeSession(id)
  expect(queueManager.getTask('openai', task.id)).toMatchObject({ status: 'completed', baseName: name, imagePath: `${name}.png` })
  expect(queueManager.getTask('openai', task.id)?.pendingOutput).toBeUndefined()
  processQueues()
  expect(generate).toHaveBeenCalledOnce()
  expect(fs.readFileSync(path.join(directory, `${name}.png`))).toEqual(image)
})
