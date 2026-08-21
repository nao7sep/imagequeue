import { afterEach, describe, expect, it, vi } from 'vitest'
import { abortableDelay } from '../../../src/main/utils/abortable-delay'

afterEach(() => vi.useRealTimers())

describe('abortableDelay', () => {
  it('resolves when its delay elapses', async () => {
    vi.useFakeTimers()
    const promise = abortableDelay(1000, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(promise).resolves.toBeUndefined()
  })

  it('rejects immediately when aborted during the delay', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const promise = abortableDelay(60_000, controller.signal)
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not install a timer for an already-aborted signal', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    controller.abort()
    await expect(abortableDelay(60_000, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(vi.getTimerCount()).toBe(0)
  })
})
