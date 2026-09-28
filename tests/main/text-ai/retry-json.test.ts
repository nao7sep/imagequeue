import { describe, expect, it, vi } from 'vitest'
import type { TextAIProvider } from '../../../src/main/text-ai/types'

// Every elaboration attempt is paid, and the user waits on it. Only a failure that
// proves the provider did no work is sent again; a timeout, a 5xx or an unusable
// reply may have been billed, so it is reported and the user decides to retry.

vi.mock('../../../src/main/logger', () => ({ log: vi.fn(), serializeError: (e: unknown) => e }))
vi.mock('../../../src/main/utils/abortable-delay', () => ({ abortableDelay: async () => undefined }))

const { askJsonWithRetry } = await import('../../../src/main/text-ai/retry-json')
const { ProviderRefusalError, ProviderTruncationError, ProviderStatusError, ProviderHttpError } =
  await import('../../../src/main/provider-errors')

function failingProvider(error: unknown): { provider: TextAIProvider; ask: ReturnType<typeof vi.fn> } {
  const ask = vi.fn(async () => { throw error })
  return { provider: { ask } as unknown as TextAIProvider, ask }
}

function run(provider: TextAIProvider): Promise<unknown> {
  return askJsonWithRetry({
    provider,
    messages: [{ role: 'user', text: 'seed' }],
    schema: {},
    timeoutMs: 1000,
    validate: (parsed) => parsed ?? null,
    maxRetries: 3,
    backoffSchedule: [0],
    signal: new AbortController().signal,
    label: 'prose',
    requestId: 'r1',
  })
}

describe('askJsonWithRetry', () => {
  it.each([
    ['a refusal', new ProviderRefusalError('Gemini refused this request (PROHIBITED_CONTENT).', 'PROHIBITED_CONTENT')],
    ['a truncated reply', new ProviderTruncationError('The model stopped at its output limit.')],
    ['a provider finish reason', new ProviderStatusError('Gemini', 'RECITATION')],
    ['a rejected key', Object.assign(new Error('Incorrect API key'), { status: 401 })],
    ['an unknown model', Object.assign(new Error('model not found'), { status: 404 })],
  ])('reports %s on the first attempt', async (_label, error) => {
    const { provider, ask } = failingProvider(error)
    await expect(run(provider)).rejects.toBe(error)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a rate limit', new ProviderHttpError('rate limited', 429)],
    ['a request timeout answer', Object.assign(new Error('request timeout'), { status: 408 })],
    ['an unavailable service', Object.assign(new Error('unavailable'), { status: 503 })],
    ['a refused connection', Object.assign(new Error('Connection error.'), { cause: { code: 'ECONNREFUSED' } })],
    ['an unresolved host', Object.assign(new Error('Connection error.'), { cause: { cause: { code: 'ENOTFOUND' } } })],
  ])('resends %s, which proves nothing was processed', async (_label, error) => {
    const { provider, ask } = failingProvider(error)
    await expect(run(provider)).rejects.toBe(error)
    expect(ask).toHaveBeenCalledTimes(4)
  })

  it.each([
    ['a timeout', Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' })],
    ['a dropped connection', new Error('fetch failed')],
    ['a reset connection', Object.assign(new Error('Connection error.'), { cause: { code: 'ECONNRESET' } })],
    ['a server error', Object.assign(new Error('internal error'), { status: 500 })],
    ['a bad gateway', Object.assign(new Error('bad gateway'), { status: 502 })],
    ['a gateway timeout', Object.assign(new Error('gateway timeout'), { status: 504 })],
  ])('reports %s at once, leaving the resend to the user', async (_label, error) => {
    const { provider, ask } = failingProvider(error)
    await expect(run(provider)).rejects.toBe(error)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('reports a reply with no usable payload at once', async () => {
    const ask = vi.fn(async () => ({ text: 'not json', parsed: null }))
    await expect(run({ ask } as unknown as TextAIProvider)).rejects.toThrow('no usable payload')
    expect(ask).toHaveBeenCalledTimes(1)
  })
})
