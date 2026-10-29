import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// On quit the finished image must be written within the exit deadline, so
// an aborted signal skips the text-AI call (or cuts it short) and the image is
// named with the random fallback.

const ask = vi.hoisted(() => vi.fn())
const handle = vi.hoisted(() => ({ timeoutMs: 30000 }))
vi.mock('../../../src/main/config', () => ({
  loadConfig: () => ({ prompts: { slug: 'Name this: {{PROMPT}}' }}),
}))
const delay = vi.hoisted(() => vi.fn(async (_ms: number, _signal: AbortSignal): Promise<void> => undefined))
vi.mock('../../../src/main/utils/abortable-delay', () => ({ abortableDelay: delay }))
vi.mock('../../../src/main/text-ai', () => ({
  getLightProvider: () => ({ provider: { ask }, timeoutMs: handle.timeoutMs }),
}))
vi.mock('../../../src/main/logger', () => ({ log: vi.fn(), serializeError: (e: unknown) => e }))
vi.mock('../../../src/main/config/api-keys-store', () => ({ refreshApiKeys: async () => undefined }))

const { generateSlug } = await import('../../../src/main/backends/slug')

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

beforeEach(() => {
  ask.mockReset()
  handle.timeoutMs = 30000
})

describe('generateSlug', () => {
  it('names from the text AI and passes the signal through', async () => {
    ask.mockResolvedValue({ text: '{"slug":"Red Fox At Dawn"}', parsed: { slug: 'Red Fox At Dawn' } })
    const controller = new AbortController()
    await expect(generateSlug('a fox', 'task-1', controller.signal)).resolves.toBe('red-fox-at-dawn')
    expect(ask.mock.calls[0][0].schema).toEqual({
      type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'], additionalProperties: false,
    })
    const received = ask.mock.calls[0][0].signal as AbortSignal
    expect(received.aborted).toBe(false)
    controller.abort()
    expect(received.aborted).toBe(true)
  })

  it('makes the convention\'s three attempts on a repeated 503, then falls back', async () => {
    ask.mockRejectedValue(Object.assign(new Error('unavailable'), { status: 503 }))
    await expect(generateSlug('a fox', 'task-1', new AbortController().signal)).resolves.toMatch(/^[\w-]{10}$/)
    expect(ask).toHaveBeenCalledTimes(3)
  })

  it('falls back when retries exceed the shared naming deadline', async () => {
    fakeDeadlines()
    handle.timeoutMs = 500
    ask.mockImplementation(async (opts: { signal: AbortSignal }) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 300)
        opts.signal.addEventListener('abort', () => { clearTimeout(timer); reject(opts.signal.reason) })
      })
      if (ask.mock.calls.length === 1) throw Object.assign(new Error('unavailable'), { status: 503 })
      return { text: '{"slug":"Red Fox"}', parsed: { slug: 'Red Fox' } }
    })
    {
      const named = expect(generateSlug('a fox', 'task-1', new AbortController().signal)).resolves.toMatch(/^[\w-]{10}$/)
      await vi.advanceTimersByTimeAsync(500)
      await named
      expect(ask.mock.calls.map(([opts]) => opts.timeoutMs)).toEqual([500, 500])
    }
  })

  it('falls back to a random name when the answer carries no slug', async () => {
    ask.mockResolvedValue({ text: 'red-fox', parsed: undefined })
    await expect(generateSlug('a fox', 'task-1', new AbortController().signal)).resolves.toMatch(/^[\w-]{10}$/)
  })

  it('skips the call once shutdown has begun', async () => {
    const controller = new AbortController()
    controller.abort()
    const slug = await generateSlug('a fox', 'task-1', controller.signal)
    expect(ask).not.toHaveBeenCalled()
    expect(slug).toMatch(/^[\w-]{10}$/)
  })

  it('falls back to a random name when shutdown aborts the call', async () => {
    const controller = new AbortController()
    ask.mockImplementation((opts: { signal: AbortSignal }) => new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }))
    const naming = generateSlug('a fox', 'task-1', controller.signal)
    controller.abort()
    await expect(naming).resolves.toMatch(/^[\w-]{10}$/)
  })
})

it('publishes with a fallback name when server cooldown exceeds the naming deadline', async () => {
  const actual = await vi.importActual<typeof import('../../../src/main/utils/abortable-delay')>('../../../src/main/utils/abortable-delay')
  delay.mockImplementationOnce(actual.abortableDelay)
  handle.timeoutMs = 10
  const { ProviderHttpError } = await import('../../../src/main/provider-errors')
  ask.mockRejectedValue(new ProviderHttpError('busy', 503, null, '120'))
  fakeDeadlines()
  const named = expect(generateSlug('a fox', 'task-1', new AbortController().signal)).resolves.toMatch(/^[\w-]{10}$/)
  await vi.advanceTimersByTimeAsync(10)
  await named
  expect(ask).toHaveBeenCalledOnce()
})
