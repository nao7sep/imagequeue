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

  it('does not shorten a wait larger than the platform timer limit', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const resolved = vi.fn()
    const promise = abortableDelay(2_147_483_647 + 120_000, controller.signal).then(resolved)
    await vi.advanceTimersByTimeAsync(2_147_483_647)
    expect(resolved).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(119_999)
    expect(resolved).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await promise
    expect(resolved).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a long wait after its first timer chunk', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const promise = abortableDelay(2_147_483_647 + 120_000, controller.signal)
    const rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(2_147_483_647)
    controller.abort()
    await rejected
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
