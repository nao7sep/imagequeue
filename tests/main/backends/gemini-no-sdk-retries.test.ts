import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../../../src/shared/types'

// Each Gemini client passes `retryOptions: { attempts: 1 }`, so the SDK sends
// one request per call and the app's own retry policy decides every resend:
// Nano Banana resends only an answer proving no processing, and the text
// JSON/slug caller owns text retries.
vi.mock('../../../src/main/utils/abortable-delay', () => ({ abortableDelay: async () => undefined }))

vi.mock('../../../src/main/config', () => ({
  loadConfig: () => ({ image_backends: { nanobanana: { timeout_ms: 180000 } } }),
}))
vi.mock('../../../src/main/config/api-keys-store', () => ({ resolveApiKey: () => 'test-key' }))
vi.mock('../../../src/main/logger', () => ({
  log: vi.fn(), logApiRequest: vi.fn(), logApiResponse: vi.fn(), serializeError: (e: unknown) => e,
}))

const { generateNanoBanana } = await import('../../../src/main/backends/nanobanana')
const { GeminiProvider } = await import('../../../src/main/text-ai/gemini')

// retry-after-ms keeps a regressed client's resends immediate, so the count
// fails the assertion instead of waiting out the SDK's backoff.
function stubServerError(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'overloaded' } }), {
    status: 503,
    headers: { 'content-type': 'application/json', 'retry-after-ms': '1' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const task: Task = {
  id: 't1', prompt: 'a cat', backend: 'nanobanana', model: 'gemini-3-pro-image', params: {},
  status: 'generating', enqueuedAt: '2026-01-01T00:00:00.000Z', startedAt: null,
  completedAt: null, durationMs: null, imagePath: null, baseName: null, error: null,
}

describe('Gemini request attempt ownership', () => {
  it('Nano Banana caps safe 503 retries at three requests', async () => {
    const fetchMock = stubServerError()
    await expect(generateNanoBanana(task, new AbortController().signal)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('a text request is not resent after a 503', async () => {
    const fetchMock = stubServerError()
    const provider = new GeminiProvider('gemini-test', 'test-key')
    await expect(provider.ask({
      messages: [{ role: 'user', text: 'hi' }],
      timeoutMs: 30000,
      signal: new AbortController().signal,
    } as never)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
