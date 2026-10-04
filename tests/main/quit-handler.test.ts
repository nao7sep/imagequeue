import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBeforeQuitHandler } from '../../src/main/quit-handler'

afterEach(() => {
  vi.useRealTimers()
})

function setUp(shutdown: () => Promise<void>) {
  const exits: number[] = []
  const onError = vi.fn()
  const onTimeout = vi.fn()
  const handler = createBeforeQuitHandler({ shutdown, exit: (code) => exits.push(code), timeoutMs: 30_000, onError, onTimeout })
  return { handler, exits, onError, onTimeout }
}

describe('before-quit', () => {
  it('holds a second quit during a pending shutdown and exits once, only after shutdown settles', async () => {
    let finish!: () => void
    const shutdown = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const { handler, exits } = setUp(shutdown)

    const first = { preventDefault: vi.fn() }
    const second = { preventDefault: vi.fn() }
    handler(first)
    handler(second)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(first.preventDefault).toHaveBeenCalledOnce()
    expect(second.preventDefault).toHaveBeenCalledOnce()
    expect(shutdown).toHaveBeenCalledOnce()
    expect(exits).toEqual([])

    finish()
    await vi.waitFor(() => expect(exits).toEqual([0]))
    handler({ preventDefault: vi.fn() })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(exits).toEqual([0])
  })

  it('runs the synchronous start of shutdown inside the first quit', () => {
    const started = vi.fn()
    const { handler } = setUp(async () => { started() })
    handler({ preventDefault: vi.fn() })
    expect(started).toHaveBeenCalledOnce()
  })

  it('exits after a failed shutdown, reporting the failure', async () => {
    const failure = new Error('step failed')
    const { handler, exits, onError } = setUp(() => Promise.reject(failure))
    handler({ preventDefault: vi.fn() })
    await vi.waitFor(() => expect(exits).toEqual([0]))
    expect(onError).toHaveBeenCalledWith(failure)
  })

  it('exits once the bound passes when shutdown never settles', async () => {
    vi.useFakeTimers()
    const { handler, exits, onTimeout } = setUp(() => new Promise<void>(() => undefined))
    handler({ preventDefault: vi.fn() })
    await vi.advanceTimersByTimeAsync(29_999)
    expect(exits).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(exits).toEqual([0])
    expect(onTimeout).toHaveBeenCalledOnce()
  })
})
