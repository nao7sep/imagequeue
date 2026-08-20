import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackendId } from '../../../src/shared/types'

// "Stop generating" used to reach exactly one backend. Draw Things registered
// its own child-process killer; the four cloud backends registered nothing, so
// the command reported zero and did nothing while four images were being paid
// for. Registration now lives in the processor, which is what these pin: every
// backend is reachable, an SDK's own abort error still lands as `interrupted`
// rather than `failed`, and the registry is released however the run ended (a
// leaked entry would inflate the count the menu enables itself from).

let captured: { signal: AbortSignal; reject: (err: unknown) => void } | null = null

const generate = vi.fn(
  (_task: unknown, signal: AbortSignal) =>
    new Promise<{ buffer: Buffer }>((_resolve, reject) => {
      captured = { signal, reject }
    }),
)

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../../../src/main/backends/openai', () => ({ generateOpenAI: generate }))
vi.mock('../../../src/main/backends/nanobanana', () => ({ generateNanoBanana: generate }))
vi.mock('../../../src/main/backends/grok', () => ({ generateGrok: generate }))
vi.mock('../../../src/main/backends/flux', () => ({ generateFlux: generate }))
vi.mock('../../../src/main/backends/drawthings', () => ({ generateDrawThings: generate }))
vi.mock('../../../src/main/backends/slug', () => ({ generateSlug: async () => 'slug' }))
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
