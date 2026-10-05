import { beforeEach, describe, expect, it, vi } from 'vitest'

// The sidecar records the seed the backend sent, and null when it sent none.

const generate = vi.hoisted(() => vi.fn(async (): Promise<{ buffer: Buffer; seed?: number }> => ({ buffer: Buffer.from([1]) })))
const written = vi.hoisted(() => [] as Array<{ seed: number | null }>)

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
  writeImageOutput: (_t: string, _o: number, _s: string, _b: string, _buffer: Buffer, metadata: { seed: number | null }) => {
    written.push(metadata)
    return 'base'
  },
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
const { resetCancellationState } = await import('../../../src/main/backends/cancellation')

beforeEach(() => {
  generate.mockClear()
  written.length = 0
  resetCancellationState()
  queueManager.replaceAllTasks({ openai: [], nanobanana: [], grok: [], flux: [], drawthings: [] })
})

async function runOne(): Promise<{ seed: number | null }> {
  queueManager.enqueue({ prompt: 'p', backend: 'flux', model: 'flux-2-pro', params: { seed: 7 }, count: 1 } as never)
  processQueues()
  await vi.waitFor(() => expect(written).toHaveLength(1))
  return written[0]!
}

describe('the sidecar seed', () => {
  it('records the seed the backend sent', async () => {
    generate.mockResolvedValueOnce({ buffer: Buffer.from([1]), seed: 7 })
    expect((await runOne()).seed).toBe(7)
  })

  it('records null when the backend sent no seed', async () => {
    expect((await runOne()).seed).toBeNull()
  })
})
