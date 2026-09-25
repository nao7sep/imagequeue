import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../../../src/shared/types'

// The OpenAI SDK resends a timed-out, 408/409/429 or 5xx request twice by
// default. An image generation is paid and not idempotent, so every resend can
// bill another image while only one (or no) result comes back; the text path
// already has its own retry policy on top. Each client must make exactly one
// request per call, whatever the response.

vi.mock('../../../src/main/config', () => ({
  loadConfig: () => ({ image_backends: { openai: { timeout_ms: 180000 } } }),
}))
vi.mock('../../../src/main/config/api-keys-store', () => ({ resolveApiKey: () => 'sk-test' }))
vi.mock('../../../src/main/logger', () => ({
  log: vi.fn(), logApiRequest: vi.fn(), logApiResponse: vi.fn(), serializeError: (e: unknown) => e,
}))

const { generateOpenAI } = await import('../../../src/main/backends/openai')
const { OpenAIProvider } = await import('../../../src/main/text-ai/openai')

// retry-after-ms keeps a regressed client's resends immediate, so the count
// fails the assertion instead of waiting out the SDK's backoff.
function stubServerError(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'overloaded' } }), {
    status: 500,
    headers: { 'content-type': 'application/json', 'retry-after-ms': '1' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const task: Task = {
  id: 't1', prompt: 'a cat', backend: 'openai', model: 'gpt-image-2', params: {},
  status: 'generating', enqueuedAt: '2026-01-01T00:00:00.000Z', startedAt: null,
  completedAt: null, durationMs: null, imagePath: null, baseName: null, error: null,
}

describe('OpenAI clients send each paid request once', () => {
  it('image generation is not resent after a 5xx', async () => {
    const fetchMock = stubServerError()
    await expect(generateOpenAI(task, new AbortController().signal)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a text request is not resent after a 5xx', async () => {
    const fetchMock = stubServerError()
    const provider = new OpenAIProvider('gpt-test', 'sk-test', '')
    await expect(provider.ask({
      messages: [{ role: 'user', text: 'hi' }],
      timeoutMs: 30000,
      signal: new AbortController().signal,
    } as never)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
