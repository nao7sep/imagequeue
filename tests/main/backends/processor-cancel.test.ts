import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackendId } from '../../../src/shared/types'

// "Stop generating" used to reach exactly one backend. Draw Things registered
// its own child-process killer; the four cloud backends registered nothing, so
// the command reported zero and did nothing while four images were being paid
// for. Registration now lives in the processor, which is what these pin: every
// backend is reachable, an SDK's own abort error still lands as `interrupted`
// rather than `failed`, and the registry is released however the run ended (a
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
const slugState = vi.hoisted(() => ({ failNext: false }))
vi.mock('../../../src/main/backends/slug', () => ({
  generateSlug: async () => {
    if (slugState.failNext) {
      slugState.failNext = false
      throw new Error('slug service hiccup')
    }
    return 'slug'
  },
}))
vi.mock('../../../src/main/session', () => ({
  allocateOutputTimestamp: () => ({ timestamp: '20260819-000000', ordinal: 1 }),
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
const { cancelAllInFlight, inFlightCount, resetCancellationState } = await import(
  '../../../src/main/backends/cancellation'
)

const BACKENDS: BackendId[] = ['openai', 'nanobanana', 'grok', 'flux', 'drawthings']

function queueOne(backend: BackendId): void {
  queueManager.enqueue({ prompt: 'p', backend, model: 'm', params: {}, count: 1 } as never)
}

function statusOf(backend: BackendId): string {
  return queueManager.getAllStoredTasks()[backend][0].status
}

// The generator's rejection is handled one microtask later; a macrotask turn is
// enough for processTask to finish its catch and finally.
function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  generate.mockClear()
  captured = null
  slugState.failNext = false
  sentEvents.length = 0
  resetCancellationState()
  queueManager.replaceAllTasks({ openai: [], nanobanana: [], grok: [], flux: [], drawthings: [] })
})

// The processor's per-backend active count only drops when the generation's
// promise settles, and its concurrency here is 1 — so a case that leaves its
// generator hanging would block the next case from ever starting one.
afterEach(async () => {
  if (captured) {
    captured.reject(new Error('test teardown'))
    await settle()
  }
  resetCancellationState()
})

describe('stopping a generation reaches every backend', () => {
  it.each(BACKENDS)('registers %s while it runs, and aborts it on stop', async (backend) => {
    queueOne(backend)
    processQueues()
    expect(generate).toHaveBeenCalledOnce()
    expect(inFlightCount()).toBe(1)

    expect(cancelAllInFlight()).toBe(1)
    expect(captured!.signal.aborted).toBe(true)
  })

  it.each(BACKENDS)('lands a stopped %s task as interrupted, not failed', async (backend) => {
    queueOne(backend)
    processQueues()
    cancelAllInFlight()
    // What an SDK actually rejects with — its own abort error, not our message.
    captured!.reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
    await settle()

    expect(statusOf(backend)).toBe('interrupted')
    expect(queueManager.getAllStoredTasks()[backend][0].error).toBeNull()
  })
})

describe('a stop cannot reach a task past its generation', () => {
  // Once generate() resolves the image exists and, on a cloud backend, is paid
  // for. The task must leave the registry AT THAT MOMENT: a Stop during the
  // slug/write phase must find nothing to cancel — and if the slug then fails
  // for its own reasons, the task lands `failed`, never `interrupted`, because
  // retrying an interrupted task would buy the already-bought image again.
  it('counts nothing after generation, and a slug failure lands as failed', async () => {
    queueOne('openai')
    processQueues()
    expect(inFlightCount()).toBe(1)

    slugState.failNext = true
    captured!.resolve({ buffer: Buffer.from([1]) })
    // One microtask turn: generate settles, the registry entry is released,
    // and processTask is now inside the slug call.
    await Promise.resolve()
    expect(inFlightCount()).toBe(0)
    expect(cancelAllInFlight()).toBe(0)

    await settle()
    expect(statusOf('openai')).toBe('failed')
    expect(queueManager.getAllStoredTasks().openai[0].error).toContain('slug service hiccup')
  })

  // The abort itself can race a generation that succeeds anyway (the response
  // was already on the wire). signal.aborted stays true forever after — the
  // classification must not let that stale flag turn a later, unrelated
  // failure into `interrupted`.
  it('a stale abort flag cannot reclassify a post-generation failure', async () => {
    queueOne('grok')
    processQueues()
    cancelAllInFlight()
    expect(captured!.signal.aborted).toBe(true)

    slugState.failNext = true
    captured!.resolve({ buffer: Buffer.from([1]) })
    await settle()
    expect(statusOf('grok')).toBe('failed')
  })
})

describe('the queue broadcasts control state as work starts and settles', () => {
  // The handlers' broadcasts cannot see starts and settles, so without the
  // processor's own broadcast an open All Queues menu shows counts frozen at
  // the moment it opened.
  it('sends queue:controlState alongside queue:updated', async () => {
    queueOne('flux')
    processQueues()
    expect(sentEvents.find((event) => event.channel === 'queue:controlState')?.payload)
      .toMatchObject({ generating: 1 })

    sentEvents.length = 0
    captured!.reject(new Error('boom'))
    await settle()
    expect(sentEvents.map((event) => event.channel)).toContain('queue:controlState')
    expect(sentEvents.map((event) => event.channel)).toContain('queue:updated')
  })
})

describe('the registry is released however the run ended', () => {
  it('drops the entry after a stop', async () => {
    queueOne('flux')
    processQueues()
    cancelAllInFlight()
    captured!.reject(new Error('Generation stopped.'))
    await settle()
    expect(inFlightCount()).toBe(0)
  })

  it('drops the entry after an ordinary failure', async () => {
    queueOne('openai')
    processQueues()
    captured!.reject(new Error('API error 500'))
    await settle()
    expect(statusOf('openai')).toBe('failed')
    expect(inFlightCount()).toBe(0)
  })
})
