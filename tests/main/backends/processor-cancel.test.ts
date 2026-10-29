import * as logger from '../../../src/main/logger'
import { startAiCall } from '../../../src/main/records'
import { tinyPng } from '../image-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackendId } from '../../../src/shared/types'
import { until } from '../../renderer/until'

// "Stop generating" used to reach exactly one backend. Draw Things registered
// its own child-process killer; the four cloud backends registered nothing, so
// the command reported zero and did nothing while four images were being paid
// for. Registration now lives in the processor, which is what these pin: every
// backend is reachable, an SDK's own abort error still lands as `interrupted`
// rather than `failed`, and the run leaves its lane however it ended (a
// leaked entry would inflate the count the menu enables itself from).

let captured: {
  signal: AbortSignal
  resolve: (v: { buffer: Buffer }) => void
  reject: (err: unknown) => void
} | null = null

const generate = vi.fn(
  (_task: unknown, signal: AbortSignal) =>
    new Promise<{ buffer: Buffer }>((resolve, reject) => {
      captured = { signal, resolve, reject }
    }),
)

const sentEvents = vi.hoisted(() => [] as { channel: string; payload: unknown }[])
vi.mock('electron', () => ({
  ipcMain: { handle: () => undefined },
  BrowserWindow: {
    getAllWindows: () => [
      { webContents: { send: (channel: string, payload: unknown) => { sentEvents.push({ channel, payload }) } } },
    ],
  },
}))
vi.mock('../../../src/main/backends/openai', () => ({ generateOpenAI: generate }))
vi.mock('../../../src/main/backends/nanobanana', () => ({ generateNanoBanana: generate }))
vi.mock('../../../src/main/backends/grok', () => ({ generateGrok: generate }))
vi.mock('../../../src/main/backends/flux', () => ({ generateFlux: generate }))
vi.mock('../../../src/main/backends/drawthings', () => ({ generateDrawThings: generate }))
const slugState = vi.hoisted(() => ({ failNext: false, hangUntilAborted: false, sawAbort: false, entered: false }))
vi.mock('../../../src/main/backends/slug', () => ({
  generateSlug: async (_prompt: string, _taskId: string, signal: AbortSignal) => {
    slugState.entered = true
    if (slugState.failNext) {
      slugState.failNext = false
      throw new Error('slug service hiccup')
    }
    if (slugState.hangUntilAborted) {
      // A slow text-AI call: it ends only when shutdown aborts it, and then
      // falls back to a random name as the real generateSlug does.
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
      slugState.sawAbort = true
      // The SDK's rejection lands a turn of the event loop after the abort.
      await new Promise((r) => setImmediate(r))
      return 'random-name'
    }
    return 'slug'
  },
}))
vi.mock('../../../src/main/session', () => ({
  isSessionMutationPending: () => false,
  allocateOutputTimestamp: () => ({ timestamp: '20260819-000000', utc: '2026-08-19T00:00:00.000Z', ordinal: 1 }),
  persistActiveSession: () => undefined,
}))
vi.mock('../../../src/main/utils/file-output', () => ({
  writeImageOutput: () => 'base',
  ImageExt: {},
}))
vi.mock('../../../src/main/config', () => ({
  loadConfig: () => ({
    image_backends: {
      openai: { concurrency: 1 }, nanobanana: { concurrency: 1 },
      grok: { concurrency: 1 }, flux: { concurrency: 1 }, drawthings: { concurrency: 1 },
    },
  }),
}))

const { processQueues } = await import('../../../src/main/backends/processor')
const { queueManager } = await import('../../../src/main/queue/queue-manager')
const { stopGenerations, stopAllRuns, generatingCount, resetCancellationState } = await import(
  '../../../src/main/backends/cancellation'
)

const BACKENDS: BackendId[] = ['openai', 'nanobanana', 'grok', 'flux', 'drawthings']

function queueOne(backend: BackendId): void {
  queueManager.enqueue({ prompt: 'p', backend, model: 'm', params: {}, count: 1 } as never)
}

function statusOf(backend: BackendId): string {
  return queueManager.getAllStoredTasks()[backend][0].status
}

// Decoding and publication can settle on native workers, beyond a JS turn.
async function settle(): Promise<void> {
  await until(() => expect(Object.values(queueManager.getAllStoredTasks()).flat().some(task => task.status === 'generating')).toBe(false))
}

beforeEach(() => {
  generate.mockClear()
  captured = null
  slugState.failNext = false
  slugState.hangUntilAborted = false
  slugState.sawAbort = false
  slugState.entered = false
  sentEvents.length = 0
  resetCancellationState()
  queueManager.replaceAllTasks({ openai: [], nanobanana: [], grok: [], flux: [], drawthings: [] })
})

// A lane's width only drops when its run settles, and its concurrency here is
// 1 — so a case that leaves its generator hanging would block the next case
// from ever starting one.
afterEach(async () => {
  if (captured) {
    captured.reject(new Error('test teardown'))
    await stopAllRuns()
  }
  resetCancellationState()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('stopping a generation reaches every backend', () => {
  it.each(BACKENDS)('registers %s while it runs, and aborts it on stop', async (backend) => {
    queueOne(backend)
    processQueues()
    await Promise.resolve()
    expect(generate).toHaveBeenCalledOnce()
    expect(generatingCount()).toBe(1)

    expect(stopGenerations()).toBe(1)
    expect(captured!.signal.aborted).toBe(true)
  })

  it.each(BACKENDS)('lands a stopped %s task as interrupted, not failed', async (backend) => {
    queueOne(backend)
    processQueues()
    await Promise.resolve()
    stopGenerations()
    // What an SDK actually rejects with — its own abort error, not our message.
    captured!.reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
    await settle()

    expect(statusOf(backend)).toBe('interrupted')
    expect(queueManager.getAllStoredTasks()[backend][0].error).toBeNull()
  })
})

describe('a stop cannot reach a task past its generation', () => {
  // Once generate() resolves the image exists and, on a cloud backend, is paid
  // for. The run must stop being cancellable AT THAT MOMENT: a Stop during the
  // slug/write phase must find nothing to cancel — and if the slug then fails
  // for its own reasons, the task lands `failed`, never `interrupted`, because
  // retrying an interrupted task would buy the already-bought image again.
  it('counts nothing after generation, and a slug failure lands as failed', async () => {
    queueOne('openai')
    processQueues()
    await Promise.resolve()
    expect(generatingCount()).toBe(1)

    slugState.failNext = true
    captured!.resolve({ buffer: await tinyPng() })
    // One microtask turn: generate settles and the run stops being
    // cancellable, while decoding and naming continue.
    await Promise.resolve()
    expect(generatingCount()).toBe(0)
    expect(stopGenerations()).toBe(0)

    await settle()
    expect(statusOf('openai')).toBe('failed')
    // The task keeps the message, never the diagnostic that caused it.
    expect(queueManager.getAllStoredTasks().openai[0].error).toEqual({ key: 'taskFailure.notSaved' })
    expect(JSON.stringify(queueManager.getAllStoredTasks().openai[0].error)).not.toContain('slug service hiccup')
  })

  // The abort itself can race a generation that succeeds anyway (the response
  // was already on the wire). signal.aborted stays true forever after — the
  // classification must not let that stale flag turn a later, unrelated
  // failure into `interrupted`.
  it('a stale abort flag cannot reclassify a post-generation failure', async () => {
    queueOne('grok')
    processQueues()
    await Promise.resolve()
    stopGenerations()
    expect(captured!.signal.aborted).toBe(true)

    slugState.failNext = true
    captured!.resolve({ buffer: await tinyPng() })
    await settle()
    expect(statusOf('grok')).toBe('failed')
  })
})

describe('quitting while a finished image is being named', () => {
  // The paid bytes are in memory while the slug call runs. Shutdown used to
  // snapshot only the cancel registry, which the task had already left, so it
  // waited for nothing, marked the task interrupted and exited — dropping the
  // image, and a resume then bought it again.
  it('waits for the image to be saved, cutting the slug call short', async () => {
    slugState.hangUntilAborted = true
    queueOne('openai')
    processQueues()
    await Promise.resolve()
    captured!.resolve({ buffer: await tinyPng() })
    await Promise.resolve()
    expect(generatingCount()).toBe(0)

    await until(() => expect(slugState.entered).toBe(true))
    expect(sentEvents.filter((event) => event.channel === 'queue:controlState').at(-1)?.payload).toMatchObject({ generating: 0 })
    await stopAllRuns()
    expect(slugState.sawAbort).toBe(true)
    expect(statusOf('openai')).toBe('completed')
  })
})

describe('the queue broadcasts control state as work starts and settles', () => {
  // The handlers' broadcasts cannot see starts and settles, so without the
  // processor's own broadcast an open All Queues menu shows counts frozen at
  // the moment it opened.
  it('sends queue:controlState alongside queue:updated', async () => {
    queueOne('flux')
    processQueues()
    await Promise.resolve()
    expect(sentEvents.find((event) => event.channel === 'queue:controlState')?.payload)
      .toMatchObject({ generating: 1 })

    sentEvents.length = 0
    captured!.reject(new Error('boom'))
    await settle()
    expect(sentEvents.map((event) => event.channel)).toContain('queue:controlState')
    expect(sentEvents.map((event) => event.channel)).toContain('queue:updated')
  })
})

describe('a run stops counting as generating however it ended', () => {
  it('drops the entry after a stop', async () => {
    queueOne('flux')
    processQueues()
    await Promise.resolve()
    stopGenerations()
    captured!.reject(new Error('Generation stopped.'))
    await settle()
    expect(generatingCount()).toBe(0)
  })

  it('drops the entry after an ordinary failure', async () => {
    queueOne('openai')
    processQueues()
    await Promise.resolve()
    captured!.reject(new Error('API error 500'))
    await settle()
    expect(statusOf('openai')).toBe('failed')
    expect(generatingCount()).toBe(0)
  })})

describe('a failed task keeps what the provider said', () => {
  it('records the provider message whole beside the authored copy', async () => {
    const { ProviderRefusalError } = await import('../../../src/main/provider-errors')
    const said = 'Your request was rejected by the safety system. '.repeat(10).trim()
    queueOne('openai')
    processQueues()
    await Promise.resolve()
    captured!.reject(new ProviderRefusalError('OpenAI blocked this prompt (moderation_blocked).', 'moderation_blocked', said))
    await settle()
    const task = queueManager.getAllStoredTasks().openai[0]
    expect(task.status).toBe('failed')
    expect(task.error).toMatchObject({ key: 'taskFailure.refusedWithReason' })
    expect(task.providerMessage).toBe(said)
  })

  // A local run that ran out of memory reaches the task as advice with the size
  // it was asked for; the CLI's own output stays in Records, not on the task.
  it('tells the user to try a smaller size when Draw Things runs out of memory', async () => {
    const { DrawThingsOutOfMemoryError } = await import('../../../src/main/provider-errors')
    queueOne('drawthings')
    processQueues()
    await Promise.resolve()
    captured!.reject(new DrawThingsOutOfMemoryError(3840, 2176, 'killed by SIGKILL'))
    await settle()
    const task = queueManager.getAllStoredTasks().drawthings[0]
    expect(task.status).toBe('failed')
    expect(task.error).toEqual({ key: 'taskFailure.outOfMemory', values: { size: '3840×2176' } })
    expect(task.providerMessage).toBeNull()
  })

  it('records none for a failure that is not a provider answer', async () => {
    queueOne('openai')
    processQueues()
    await Promise.resolve()
    captured!.reject(new Error('socket hang up'))
    await settle()
    expect(queueManager.getAllStoredTasks().openai[0].providerMessage).toBeNull()
  })
})


it('masks echoed request credentials before task persistence and publication', async () => {
  const secret = 'fixture_request_credential'
  startAiCall({ backend: 'openai', model: 'm', purpose: 'image', request: {}, credentials: [secret] })
  const { ProviderRefusalError } = await import('../../../src/main/provider-errors')
  queueOne('openai')
  processQueues()
  await Promise.resolve()
  captured!.reject(new ProviderRefusalError('blocked', secret, `Invalid credential ${secret}; contact support.`))
  await settle()
  const serialized = JSON.stringify(queueManager.getAllStoredTasks())
  expect(serialized).not.toContain(secret)
  expect(serialized).toContain('[REDACTED]')
  expect(JSON.stringify(sentEvents)).not.toContain(secret)
  expect(queueManager.getAllStoredTasks().openai[0].providerMessage).toBe('Invalid credential [REDACTED]; contact support.')
})

it.each(['success', 'failure', 'cancel'] as const)('uses elapsed monotonic time through %s and drain completion', async (outcome) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  let now = 100
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const logged = vi.spyOn(logger, 'log')
  const failed = vi.spyOn(logger, 'logGenerationFailed')
  // Settle any preceding test's drain before opening this one.
  processQueues()
  logged.mockClear()
  queueOne('openai')
  processQueues()
  await Promise.resolve()
  now = 350
  vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
  if (outcome === 'success') captured!.resolve({ buffer: await tinyPng() })
  else {
    if (outcome === 'cancel') stopGenerations()
    captured!.reject(new Error('failure'))
  }
  await settle()
  if (outcome === 'success') expect(queueManager.getAllStoredTasks().openai[0].durationMs).toBe(250)
  if (outcome === 'failure') expect(failed).toHaveBeenCalledWith(expect.any(String), expect.any(Error), expect.objectContaining({ durationMs: 250 }))
  // The run's settlement asks the session to schedule, which closes the drain.
  await stopAllRuns()
  expect(logged).toHaveBeenCalledWith('info', 'Queue drained', { ok: outcome === 'success' ? 1 : 0, failed: outcome === 'failure' ? 1 : 0, cancelled: outcome === 'cancel' ? 1 : 0, durationMs: 250 })
})
