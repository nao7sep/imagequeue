import { tinyPng } from '../image-fixture'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AppConfig } from '../../../src/main/config/types'
import type { SessionManifest, Task } from '../../../src/shared/types'
import { createDefaultConfig } from '../../../src/main/config/defaults'

// Exercise admission and delivered-image settlement with the real queue,
// session, credential writer, naming and output owners. Providers and native
// presentation are substituted; storage failures/holds occur at real renames.
const fixture = vi.hoisted(() => ({ root: '', config: null as AppConfig | null, nextSession: Date.UTC(2026, 0, 1) }))
const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())
const generate = vi.hoisted(() => vi.fn())
const nameImage = vi.hoisted(() => vi.fn(async () => ({ parsed: { slug: 'delivered' } })))
const send = vi.hoisted(() => vi.fn())
vi.mock('../../../src/main/ipc-boundary', () => ({
  handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
}))
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ webContents: { send } }] },
  shell: { trashItem: vi.fn() },
}))
vi.mock('../../../src/main/config', () => ({ getDataDir: () => fixture.root, loadConfig: () => fixture.config! }))
vi.mock('../../../src/main/config/config-store', () => ({ getDataDir: () => fixture.root }))
vi.mock('../../../src/main/main-window-layout', () => ({ refreshMainWindowMinimumSize: () => undefined }))
vi.mock('../../../src/main/logger', () => ({
  log: vi.fn(), logEnqueue: vi.fn(), logGenerationStart: vi.fn(), logGenerationComplete: vi.fn(), logGenerationFailed: vi.fn(),
  serializeError: (error: unknown) => String(error),
}))
vi.mock('../../../src/main/backup/backup-store', () => ({ record: vi.fn() }))
vi.mock('../../../src/main/backends/openai', () => ({ generateOpenAI: generate }))
vi.mock('../../../src/main/backends/nanobanana', () => ({ generateNanoBanana: generate }))
vi.mock('../../../src/main/backends/grok', () => ({ generateGrok: generate }))
vi.mock('../../../src/main/backends/flux', () => ({ generateFlux: generate }))
vi.mock('../../../src/main/backends/drawthings', () => ({ generateDrawThings: generate }))
vi.mock('../../../src/main/text-ai', () => ({
  getLightProvider: () => ({ timeoutMs: 1_000, provider: { ask: nameImage } }),
}))
vi.mock('../../../src/main/session/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/session/session')>()
  return { ...actual, createSessionDir: async () => actual.createSessionDir(new Date(fixture.nextSession += 1_000)) }
})

const { processQueues } = await import('../../../src/main/backends/processor')
const { queueManager, createEmptyQueues } = await import('../../../src/main/queue/queue-manager')
const { registerQueueIpc } = await import('../../../src/main/queue/ipc')
const { createSession, persistActiveSession, drainSessionWrites } = await import('../../../src/main/session/state')
const { getSessionDir, setSessionDir } = await import('../../../src/main/session/session')
const { setQueuePaused, isQueuePaused, cancelAllInFlightAndWait, resetCancellationState } = await import('../../../src/main/backends/cancellation')
const credentials = await import('../../../src/main/config/api-keys-store')

const image = await tinyPng()
function manifest(): SessionManifest {
  return JSON.parse(fs.readFileSync(path.join(getSessionDir(), 'session.json'), 'utf8')) as SessionManifest
}

beforeEach(async () => {
  vi.clearAllMocks()
  fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-admission-'))
  fixture.config = createDefaultConfig()
  resetCancellationState()
  queueManager.replaceAllTasks(createEmptyQueues())
  setSessionDir(path.join(fixture.root, 'sessions', '20000101-000000-utc'))
  await createSession()
  fixture.config.general.drop_empty_sessions = false
  handlers.clear()
  registerQueueIpc()
  processQueues()
  send.mockClear()
})

afterEach(async () => {
  await cancelAllInFlightAndWait(1_000)
  vi.restoreAllMocks()
  await persistActiveSession()
  resetCancellationState()
  fs.rmSync(fixture.root, { recursive: true, force: true })
})

it.each(['queue:enqueue', 'queue:enqueueBatch'])('%s acknowledges retained tasks and pauses after a failed save, then generates that intent once', async (channel) => {
  const request = { backend: 'openai', model: 'gpt-image-2', prompt: 'a cat', params: {}, count: 2 }
  const fail = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('session unavailable'))
  const tasks = await handlers.get(channel)!({}, channel === 'queue:enqueue' ? request : [request, request]) as Task[]

  expect(tasks).toHaveLength(2)
  expect(queueManager.getAllStoredTasks().openai.map((task) => task.id).sort()).toEqual(tasks.map((task) => task.id).sort())
  expect(manifest().tasks.openai).toEqual([])
  await expect(drainSessionWrites()).rejects.toThrow('session unavailable')
  expect(isQueuePaused()).toBe(true)
  expect(send.mock.calls.filter(([name]) => name === 'queue:updated').at(-1)?.[1]).toEqual(queueManager.getAllStoredTasks())
  expect(send.mock.calls.filter(([name]) => name === 'app:notice')).toHaveLength(1)
  processQueues()
  expect(generate).not.toHaveBeenCalled()

  fail.mockRestore()
  let entered!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  generate.mockImplementation(async () => {
    if (generate.mock.calls.length === 2) entered()
    return { buffer: image }
  })
  setQueuePaused(false)
  processQueues()
  await started
  await expect(cancelAllInFlightAndWait(1_000)).resolves.toMatchObject({ settled: true })
  expect(generate).toHaveBeenCalledTimes(2)
  expect(manifest().tasks.openai.map((task) => task.id).sort()).toEqual(tasks.map((task) => task.id).sort())
  expect(manifest().tasks.openai.map((task) => task.status)).toEqual(['completed', 'completed'])
  await expect(drainSessionWrites()).resolves.toBeUndefined()
})

it('publishes a delivered image on shutdown while the credential writer keeps its held replacement', async () => {
  let deliver!: (result: { buffer: Buffer }) => void
  let entered!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  generate.mockImplementation(() => { entered(); return new Promise((resolve) => { deliver = resolve }) })
  const [task] = await handlers.get('queue:enqueue')!({}, { backend: 'openai', model: 'gpt-image-2', prompt: 'a cat', params: {}, count: 1 }) as Task[]
  processQueues()
  await started

  let release!: () => void
  let saving!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const writing = new Promise<void>((resolve) => { saving = resolve })
  const rename = fs.promises.rename.bind(fs.promises)
  vi.spyOn(fs.promises, 'rename').mockImplementation(async (source, destination) => {
    if (String(destination).endsWith('api-keys.json')) { saving(); await held }
    await rename(source, destination)
  })
  let saved = false
  const keySave = credentials.setStoredApiKey('openai.text', 'test-credential').then(() => { saved = true })
  await writing
  let naming!: () => void
  const refreshing = new Promise<void>((resolve) => { naming = resolve })
  const refresh = credentials.refreshApiKeys
  vi.spyOn(credentials, 'refreshApiKeys').mockImplementation(() => { naming(); return refresh() })
  try {
    deliver({ buffer: image })
    await refreshing
    await expect(cancelAllInFlightAndWait(1_000)).resolves.toMatchObject({ settled: true })
    expect(saved).toBe(false)
    const completed = manifest().tasks.openai.find((entry) => entry.id === task.id)!
    expect(completed.status).toBe('completed')
    expect(fs.readFileSync(path.join(getSessionDir(), completed.imagePath!))).toEqual(image)
    expect(generate).toHaveBeenCalledOnce()
  } finally {
    release()
    await keySave
    await cancelAllInFlightAndWait(1_000)
    await credentials.refreshApiKeys()
  }
  expect(credentials.getStoredApiKey('openai.text')).toBe('test-credential')
})

it('keeps a delivered image when optional naming cannot refresh credentials', async () => {
  generate.mockResolvedValue({ buffer: image })
  const [task] = await handlers.get('queue:enqueue')!({}, { backend: 'openai', model: 'gpt-image-2', prompt: 'a cat', params: {}, count: 1 }) as Task[]
  vi.spyOn(credentials, 'refreshApiKeys').mockRejectedValue(new Error('credentials unavailable'))
  processQueues()
  await vi.waitFor(() => expect(queueManager.getTask('openai', task.id)?.status).toBe('completed'))
  await expect(drainSessionWrites()).resolves.toBeUndefined()
  const completed = manifest().tasks.openai[0]
  expect(fs.readFileSync(path.join(getSessionDir(), completed.imagePath!))).toEqual(image)
})

it('fails invalid delivered bytes without naming, publishing or automatically generating again', async () => {
  generate.mockResolvedValue({ buffer: Buffer.from('<html>provider error</html>'), mimeType: 'image/png' })
  const [task] = await handlers.get('queue:enqueue')!({}, { backend: 'openai', model: 'gpt-image-2', prompt: 'a cat', params: {}, count: 1 }) as Task[]
  processQueues()
  await vi.waitFor(() => expect(queueManager.getAllStoredTasks().openai[0].status).toBe('failed'))
  await cancelAllInFlightAndWait(1_000)
  await drainSessionWrites()
  expect(manifest().tasks.openai[0]).toMatchObject({ id: task.id, status: 'failed', baseName: null, imagePath: null })
  expect(nameImage).not.toHaveBeenCalled()
  expect(fs.readdirSync(getSessionDir()).some(name => /\.(png|jpg|webp)$/.test(name))).toBe(false)
  processQueues()
  expect(generate).toHaveBeenCalledOnce()
})
