import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AskOptions, TextAIProvider } from '../../../src/main/text-ai/types'

// Every elaboration attempt is paid, and the user waits on it. Only a failure that
// proves the provider did no work is sent again; a timeout, a 5xx or an unusable
// reply may have been billed, so it is reported and the user decides to retry.

vi.mock('../../../src/main/logger', () => ({ log: vi.fn(), serializeError: (e: unknown) => e }))
const delay = vi.hoisted(() => vi.fn(async (_ms: number, _signal: AbortSignal): Promise<void> => undefined))
vi.mock('../../../src/main/utils/abortable-delay', () => ({ abortableDelay: delay }))

const { askJsonWithRetry } = await import('../../../src/main/text-ai/retry-json')
const { ProviderRefusalError, ProviderTruncationError, ProviderStatusError, ProviderHttpError } =
  await import('../../../src/main/provider-errors')

// Product deadlines run on the fake clock. Vitest does not fake
// AbortSignal.timeout, so it is replaced with a faked timer.
function fakeDeadlines(): void {
  vi.useFakeTimers()
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const deadline = new AbortController()
    setTimeout(() => deadline.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms)
    return deadline.signal
  })
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function failingProvider(error: unknown): { provider: TextAIProvider; ask: ReturnType<typeof vi.fn> } {
  const ask = vi.fn(async () => { throw error })
  return { provider: { ask } as unknown as TextAIProvider, ask }
}

function run(provider: TextAIProvider, timeoutMs = 1000): Promise<unknown> {
  return askJsonWithRetry({
    provider,
    messages: [{ role: 'user', text: 'seed' }],
    schema: {},
    timeoutMs,
    validate: (parsed) => parsed ?? null,
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
    expect(ask).toHaveBeenCalledTimes(3)
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

  it('keeps all attempts inside the shared timeout', async () => {
    fakeDeadlines()
    const error = new ProviderHttpError('busy', 503)
    const ask = vi.fn(async (opts: AskOptions) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 300)
        opts.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(opts.signal?.reason) })
      })
      if (ask.mock.calls.length === 1) throw error
      return { text: '{}', parsed: {} }
    })
    {
      const failed = expect(run({ ask } as unknown as TextAIProvider, 500)).rejects.toMatchObject({ name: 'TimeoutError' })
      await vi.advanceTimersByTimeAsync(500)
      await failed
      expect(ask.mock.calls.map(([opts]) => opts.timeoutMs)).toEqual([500, 500])
    }
  })

  it('reports a reply with no usable payload at once', async () => {
    const ask = vi.fn(async () => ({ text: 'not json', parsed: null }))
    await expect(run({ ask } as unknown as TextAIProvider)).rejects.toThrow('no usable payload')
    expect(ask).toHaveBeenCalledTimes(1)
  })
})

it('ends a long server cooldown at the text deadline without another request', async () => {
  const actual = await vi.importActual<typeof import('../../../src/main/utils/abortable-delay')>('../../../src/main/utils/abortable-delay')
  delay.mockImplementationOnce(actual.abortableDelay)
  const { provider, ask } = failingProvider(new ProviderHttpError('busy', 503, null, '120'))
  fakeDeadlines()
  const failed = expect(run(provider, 10)).rejects.toMatchObject({ name: 'TimeoutError' })
  await vi.advanceTimersByTimeAsync(10)
  await failed
  expect(ask).toHaveBeenCalledOnce()
})

it('retains ownership of an admitted request until a late successful answer settles', async () => {
  let finish!: (result: { text: string; parsed: object }) => void
  let signal!: AbortSignal
  const ask = vi.fn((options: AskOptions) => {
    signal = options.signal!
    return new Promise<{ text: string; parsed: object }>(resolve => { finish = resolve })
  })
  let settled = false
  fakeDeadlines()
  const pending = run({ ask }, 10).finally(() => { settled = true })
  await vi.advanceTimersByTimeAsync(10)
  expect(signal.aborted).toBe(true)
  expect(settled).toBe(false)
  finish({ text: '{}', parsed: {} })
  await expect(pending).resolves.toEqual({})
  expect(ask).toHaveBeenCalledOnce()
})
