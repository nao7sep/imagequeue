import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A full or unavailable disk makes the session manifest write throw. At task
// start that throw used to escape the 500 ms tick as an uncaught exception, and
// the crash handler exited the app mid-batch with paid generations in flight.
// The processor owns the failure: the task stays queued, the queue pauses, and
// the user is told once.

const generate = vi.fn(async () => ({ buffer: Buffer.from([1]) }))
const persist = vi.hoisted(() => ({ fail: false, calls: 0 }))
const sent = vi.hoisted(() => [] as { channel: string; payload: unknown }[])

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      { webContents: { send: (channel: string, payload: unknown) => { sent.push({ channel, payload }) } } },
    ],
  },
}))
vi.mock('../../../src/main/main-window-layout', () => ({ refreshMainWindowMinimumSize: () => undefined }))
vi.mock('../../../src/main/backends/openai', () => ({ generateOpenAI: generate }))
vi.mock('../../../src/main/backends/nanobanana', () => ({ generateNanoBanana: generate }))
vi.mock('../../../src/main/backends/grok', () => ({ generateGrok: generate }))
vi.mock('../../../src/main/backends/flux', () => ({ generateFlux: generate }))
vi.mock('../../../src/main/backends/drawthings', () => ({ generateDrawThings: generate }))
vi.mock('../../../src/main/backends/slug', () => ({ generateSlug: async () => 'slug' }))
vi.mock('../../../src/main/session', () => ({
  allocateOutputTimestamp: () => ({ timestamp: '20260819-000000', ordinal: 1 }),
  persistActiveSession: () => {
    persist.calls++
    if (persist.fail) throw Object.assign(new Error('ENOSPC: no space left on device /secret/path'), { code: 'ENOSPC' })
  },
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
const { isQueuePaused, resetCancellationState } = await import('../../../src/main/backends/cancellation')

function queueOne(): void {
  queueManager.enqueue({ prompt: 'p', backend: 'openai', model: 'm', params: {}, count: 1 } as never)
}

function notices(): unknown[] {
  return sent.filter((event) => event.channel === 'app:notice').map((event) => event.payload)
}

function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  generate.mockClear()
  persist.fail = false
  persist.calls = 0
  sent.length = 0
  resetCancellationState()
  queueManager.replaceAllTasks({ openai: [], nanobanana: [], grok: [], flux: [], drawthings: [] })
})

afterEach(() => resetCancellationState())

describe('a manifest write failure while the queue runs', () => {
  it('at task start: starts nothing, keeps the task queued, pauses and tells the user', () => {
    persist.fail = true
    queueOne()
    expect(() => processQueues()).not.toThrow()

    expect(generate).not.toHaveBeenCalled()
    const task = queueManager.getAllStoredTasks().openai[0]
    expect(task.status).toBe('queued')
    expect(task.startedAt).toBeNull()
    expect(isQueuePaused()).toBe(true)
    expect(notices()).toHaveLength(1)
    expect(JSON.stringify(notices()[0])).not.toMatch(/ENOSPC|secret/)
  })

  it('tells the user once, and the next tick starts nothing while paused', () => {
    persist.fail = true
    queueOne()
    processQueues()
    processQueues()
    expect(persist.calls).toBe(1)
    expect(notices()).toHaveLength(1)
  })

  it('at task finish: the result stays in memory, the queue pauses, nothing is thrown', async () => {
    queueOne()
    processQueues()
    persist.fail = true
    await settle()

    expect(queueManager.getAllStoredTasks().openai[0].status).toBe('completed')
    expect(isQueuePaused()).toBe(true)
    expect(notices()).toHaveLength(1)
  })
})
