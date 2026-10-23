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
const { createSession, resumeSession, persistActiveSession, drainSessionWrites } = await import('../../../src/main/session/state')
const { getSessionDir, getSessionId, setSessionDir } = await import('../../../src/main/session/session')
const { setQueuePaused, isQueuePaused, cancelAllInFlightAndWait, resetCancellationState } = await import('../../../src/main/backends/cancellation')

let rejectDelivery: (error: Error) => void = () => undefined

function readManifest(dir: string): SessionManifest {
  return JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8')) as SessionManifest
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
  await cancelAllInFlightAndWait(1_000)
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
  const finalSaveFailure = vi.spyOn(fs.promises, 'rename').mockRejectedValue(new Error('session unavailable'))
  const image = await tinyPng()
  deliver({ buffer: image })
  // The shutdown barrier waits for actual publication and final-save attempts,
  // including a delivered result that wins a race with cancellation.
  await expect(cancelAllInFlightAndWait(1_000)).resolves.toEqual({ signalled: 2, settled: true })

  expect(isQueuePaused()).toBe(true)
  const completed = queueManager.getAllStoredTasks().openai
  expect(completed.map((task) => task.status)).toEqual(['completed', 'completed'])
  for (const task of completed) {
    expect(fs.readFileSync(path.join(dir, task.imagePath!))).toEqual(image)
    expect(fs.existsSync(path.join(dir, `${task.baseName}.json`))).toBe(false)
  }
  expect(readManifest(dir).tasks.openai.map((task) => task.status)).toEqual(['generating', 'generating'])
  await expect(drainSessionWrites()).rejects.toThrow('session unavailable')
  expect(send.mock.calls.filter(([channel]) => channel === 'app:notice').map(([, notice]) => notice)).toEqual([
    { title: { key: 'notice.queuePausedTitle' }, message: { key: 'notice.queuePausedMessage' } },
  ])

  sidecarFailure.mockRestore()
  finalSaveFailure.mockRestore()
  await persistActiveSession()
  await expect(drainSessionWrites()).resolves.toBeUndefined()
  await createSession()
  await resumeSession(sessionId)
  expect(queueManager.getAllStoredTasks().openai).toEqual(completed)
  expect(new Set(readManifest(dir).tasks.openai.map((task) => task.id))).toEqual(new Set(queued.map((task) => task.id)))
  for (const task of completed) expect(fs.readFileSync(path.join(dir, task.imagePath!))).toEqual(image)
  setQueuePaused(false)
  processQueues()
  expect(generate).toHaveBeenCalledTimes(2)
})
