import { beforeEach, describe, expect, it, vi } from 'vitest'

// On quit the finished image must be written inside the shutdown barrier, so
// an aborted signal skips the text-AI call (or cuts it short) and the image is
// named with the random fallback.

const ask = vi.hoisted(() => vi.fn())
const handle = vi.hoisted(() => ({ timeoutMs: 30000 }))
vi.mock('../../../src/main/config', () => ({
  loadConfig: () => ({ prompts: { slug: 'Name this: {{PROMPT}}' }, brainstorm: { max_retries_per_turn: 5 } }),
}))
vi.mock('../../../src/main/utils/abortable-delay', () => ({ abortableDelay: async () => undefined }))
vi.mock('../../../src/main/text-ai', () => ({
  getLightProvider: () => ({ provider: { ask }, timeoutMs: handle.timeoutMs }),
}))
vi.mock('../../../src/main/logger', () => ({ log: vi.fn(), serializeError: (e: unknown) => e }))

const { generateSlug } = await import('../../../src/main/backends/slug')

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

  it('makes max_retries_per_turn + 1 attempts on a repeated 503, then falls back', async () => {
    ask.mockRejectedValue(Object.assign(new Error('unavailable'), { status: 503 }))
    await expect(generateSlug('a fox', 'task-1', new AbortController().signal)).resolves.toMatch(/^[\w-]{10}$/)
    expect(ask).toHaveBeenCalledTimes(6)
  })

  it('gives each attempt its own full provider timeout', async () => {
    handle.timeoutMs = 500
    ask.mockImplementation(async (opts: { signal: AbortSignal }) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 300)
        opts.signal.addEventListener('abort', () => { clearTimeout(timer); reject(opts.signal.reason) })
      })
      if (ask.mock.calls.length === 1) throw Object.assign(new Error('unavailable'), { status: 503 })
      return { text: '{"slug":"Red Fox"}', parsed: { slug: 'Red Fox' } }
    })
    await expect(generateSlug('a fox', 'task-1', new AbortController().signal)).resolves.toBe('red-fox')
    expect(ask.mock.calls.map(([opts]) => opts.timeoutMs)).toEqual([500, 500])
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
