import { beforeEach, describe, expect, it, vi } from 'vitest'

// The sidecar records the seed the backend sent, and null when it sent none,
// and its file_timestamp is the time in the file name.

const generate = vi.hoisted(() => vi.fn(async (): Promise<{ buffer: Buffer; seed?: number }> => ({ buffer: Buffer.from([1]) })))
const written = vi.hoisted(() => [] as Array<{ seed: number | null; file_timestamp: string }>)

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../../../src/main/backends/openai', () => ({ generateOpenAI: generate }))
vi.mock('../../../src/main/backends/nanobanana', () => ({ generateNanoBanana: generate }))
vi.mock('../../../src/main/backends/grok', () => ({ generateGrok: generate }))
vi.mock('../../../src/main/backends/flux', () => ({ generateFlux: generate }))
vi.mock('../../../src/main/backends/drawthings', () => ({ generateDrawThings: generate }))
vi.mock('../../../src/main/backends/slug', () => ({ generateSlug: async () => 'slug' }))
vi.mock('../../../src/main/session', () => ({
  isSessionMutationPending: () => false,
  allocateOutputTimestamp: () => ({ timestamp: '20260819-000000', utc: '2026-08-19T00:00:00.000Z', ordinal: 1 }),
  persistActiveSession: () => undefined,
}))
vi.mock('../../../src/main/utils/file-output', () => ({
  writeImageOutput: (_t: string, _o: number, _s: string, _b: string, _buffer: Buffer, metadata: { seed: number | null; file_timestamp: string }) => {
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

async function runOne(): Promise<{ seed: number | null; file_timestamp: string }> {
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

describe('the sidecar file_timestamp', () => {
  it('is the second the file is named after', async () => {
    expect((await runOne()).file_timestamp).toBe('2026-08-19T00:00:00.000Z')
  })
})
