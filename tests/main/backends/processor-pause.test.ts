import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The pause flag only matters if the POLLER honours it. The processor wakes
// every 500ms and starts any task sitting in `queued` — which is exactly why
// killing a generation from outside the app never helped: the next task simply
// started. This pins the check that makes stopping stick.

const generate = vi.fn(async () => ({ buffer: Buffer.from([1]) }))

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
// The loop reads concurrency for EVERY backend, not just the one under test.
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
const { setQueuePaused, resetCancellationState } = await import(
  '../../../src/main/backends/cancellation'
)

beforeEach(() => {
  generate.mockClear()
  resetCancellationState()
  queueManager.replaceAllTasks({ openai: [], nanobanana: [], grok: [], flux: [], drawthings: [] })
})

afterEach(() => resetCancellationState())

function queueOne(): void {
  queueManager.enqueue({
    prompt: 'p', backend: 'openai', model: 'm', params: {}, count: 1,
  } as never)
}

describe('processor pause', () => {
  it('starts a queued task when running', () => {
    queueOne()
    processQueues()
    expect(generate).toHaveBeenCalledOnce()
  })

  it('starts NOTHING while paused', () => {
    queueOne()
    setQueuePaused(true)
    processQueues()
    expect(generate).not.toHaveBeenCalled()
    // The task is untouched — still waiting, not failed or dropped.
    expect(queueManager.getAllStoredTasks().openai[0].status).toBe('queued')
  })

  it('resumes picking up work when unpaused', () => {
    queueOne()
    setQueuePaused(true)
    processQueues()
    setQueuePaused(false)
    processQueues()
    expect(generate).toHaveBeenCalledOnce()
  })
})
