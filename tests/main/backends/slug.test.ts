import { beforeEach, describe, expect, it, vi } from 'vitest'

// On quit the finished image must be written inside the shutdown barrier, so
// an aborted signal skips the text-AI call (or cuts it short) and the image is
// named with the random fallback.

const ask = vi.hoisted(() => vi.fn())
vi.mock('../../../src/main/config', () => ({
  loadConfig: () => ({ prompts: { slug: 'Name this: {{PROMPT}}' } }),
}))
vi.mock('../../../src/main/text-ai', () => ({
  getLightProvider: () => ({ provider: { ask }, timeoutMs: 30000 }),
}))
vi.mock('../../../src/main/logger', () => ({ log: vi.fn(), serializeError: (e: unknown) => e }))

const { generateSlug } = await import('../../../src/main/backends/slug')

beforeEach(() => {
  ask.mockReset()
})

describe('generateSlug', () => {
  it('names from the text AI and passes the signal through', async () => {
    ask.mockResolvedValue({ text: 'Red Fox At Dawn' })
    const signal = new AbortController().signal
    await expect(generateSlug('a fox', signal)).resolves.toBe('red-fox-at-dawn')
    expect(ask.mock.calls[0][0].signal).toBe(signal)
  })

  it('skips the call once shutdown has begun', async () => {
    const controller = new AbortController()
    controller.abort()
    const slug = await generateSlug('a fox', controller.signal)
    expect(ask).not.toHaveBeenCalled()
    expect(slug).toMatch(/^[\w-]{10}$/)
  })

  it('falls back to a random name when shutdown aborts the call', async () => {
    const controller = new AbortController()
    ask.mockImplementation((opts: { signal: AbortSignal }) => new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }))
    const naming = generateSlug('a fox', controller.signal)
    controller.abort()
    await expect(naming).resolves.toMatch(/^[\w-]{10}$/)
  })
})
