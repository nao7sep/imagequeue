import { describe, expect, it, vi } from 'vitest'
import type { TextAIProvider } from '../../../src/main/text-ai/types'

// Every elaboration attempt is paid. A refusal, a truncated reply, a bad key or
// an unknown model is the same on every attempt, so only a failure that may pass
// on another try is sent again.

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
    ['a network failure', new Error('fetch failed')],
    ['a rate limit', new ProviderHttpError('rate limited', 429)],
    ['a server error', Object.assign(new Error('overloaded'), { status: 503 })],
  ])('retries %s', async (_label, error) => {
    const { provider, ask } = failingProvider(error)
    await expect(run(provider)).rejects.toBe(error)
    expect(ask).toHaveBeenCalledTimes(4)
  })

  it('retries a reply with no usable payload', async () => {
    const ask = vi.fn(async () => ({ text: 'not json', parsed: null }))
    await expect(run({ ask } as unknown as TextAIProvider)).rejects.toThrow('no usable payload')
    expect(ask).toHaveBeenCalledTimes(4)
  })
})
