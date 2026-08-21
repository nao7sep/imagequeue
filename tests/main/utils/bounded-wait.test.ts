import { describe, expect, it, vi } from 'vitest'
import { waitForAllSettledWithin } from '../../../src/main/utils/bounded-wait'

describe('waitForAllSettledWithin', () => {
  it('waits until every promise settles, including rejection', async () => {
    let resolve!: () => void
    const pending = new Promise<void>((done) => { resolve = done })
    const waiting = waitForAllSettledWithin([pending, Promise.reject(new Error('expected'))], 1_000)

    let finished = false
    void waiting.then(() => { finished = true })
    await Promise.resolve()
    expect(finished).toBe(false)

    resolve()
    await expect(waiting).resolves.toBe(true)
  })

  it('returns false at the deadline', async () => {
    vi.useFakeTimers()
    const waiting = waitForAllSettledWithin([new Promise(() => undefined)], 25)
    await vi.advanceTimersByTimeAsync(25)
    await expect(waiting).resolves.toBe(false)
    vi.useRealTimers()
  })
})
