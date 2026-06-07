import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCoalescedWriter } from '../../../src/main/utils/coalesced-writer'

describe('createCoalescedWriter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('coalesces many schedule() calls in a window into a single flush', () => {
    const flush = vi.fn()
    const writer = createCoalescedWriter({ flush, debounceMs: 200 })

    writer.schedule()
    writer.schedule()
    writer.schedule()
    expect(flush).not.toHaveBeenCalled() // leading-edge timer, not yet fired

    vi.advanceTimersByTime(200)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('re-arms after a flush so a later change writes again', () => {
    const flush = vi.fn()
    const writer = createCoalescedWriter({ flush, debounceMs: 200 })

    writer.schedule()
    vi.advanceTimersByTime(200)
    expect(flush).toHaveBeenCalledTimes(1)

    writer.schedule()
    vi.advanceTimersByTime(200)
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('drain() flushes a pending write immediately and clears the timer', () => {
    const flush = vi.fn()
    const onDrain = vi.fn()
    const writer = createCoalescedWriter({ flush, debounceMs: 200, onDrain })

    writer.schedule()
    writer.drain()
    expect(flush).toHaveBeenCalledTimes(1)
    expect(onDrain).toHaveBeenCalledTimes(1)

    // Timer was cleared, so advancing does not flush again.
    vi.advanceTimersByTime(200)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('drain() is a no-op when nothing is pending', () => {
    const flush = vi.fn()
    const onDrain = vi.fn()
    const writer = createCoalescedWriter({ flush, debounceMs: 200, onDrain })

    writer.drain()
    expect(flush).not.toHaveBeenCalled()
    expect(onDrain).not.toHaveBeenCalled()
  })

  it('cancel() drops a pending write without flushing', () => {
    const flush = vi.fn()
    const writer = createCoalescedWriter({ flush, debounceMs: 200 })

    writer.schedule()
    writer.cancel()
    vi.advanceTimersByTime(200)
    expect(flush).not.toHaveBeenCalled()
  })

  it('drain() after the timer already fired is a no-op', () => {
    const flush = vi.fn()
    const onDrain = vi.fn()
    const writer = createCoalescedWriter({ flush, debounceMs: 200, onDrain })

    writer.schedule()
    vi.advanceTimersByTime(200)
    expect(flush).toHaveBeenCalledTimes(1)

    // Timer already fired and cleared itself; a drain now must not re-flush.
    writer.drain()
    expect(flush).toHaveBeenCalledTimes(1)
    expect(onDrain).not.toHaveBeenCalled()
  })

  it('routes a flush() throw to onError instead of crashing the timer', () => {
    const error = new Error('disk full')
    const flush = vi.fn(() => { throw error })
    const onError = vi.fn()
    const writer = createCoalescedWriter({ flush, debounceMs: 200, onError })

    writer.schedule()
    expect(() => vi.advanceTimersByTime(200)).not.toThrow()
    expect(onError).toHaveBeenCalledWith(error)
  })

  it('re-arms after an onError-routed failure so the next change still writes', () => {
    // Regression guard: a thrown flush must still clear the timer, or every
    // future schedule() would be swallowed by the leading-edge guard and writes
    // would stall permanently.
    let failNext = true
    const flush = vi.fn(() => {
      if (failNext) { failNext = false; throw new Error('transient') }
    })
    const onError = vi.fn()
    const writer = createCoalescedWriter({ flush, debounceMs: 200, onError })

    writer.schedule()
    vi.advanceTimersByTime(200)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)

    writer.schedule()
    vi.advanceTimersByTime(200)
    expect(flush).toHaveBeenCalledTimes(2) // re-armed, not stuck
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('rethrows a flush() error from drain() when no onError is provided', () => {
    const flush = vi.fn(() => { throw new Error('boom') })
    const writer = createCoalescedWriter({ flush, debounceMs: 200 })

    writer.schedule()
    expect(() => writer.drain()).toThrow('boom')
  })

  it('drain() does not call onDrain when the flush fails (routes to onError instead)', () => {
    // A failed quit-flush must not emit a success-implying onDrain log over data
    // that was actually lost; the failure goes to onError and onDrain is skipped.
    const error = new Error('disk full')
    const flush = vi.fn(() => { throw error })
    const onError = vi.fn()
    const onDrain = vi.fn()
    const writer = createCoalescedWriter({ flush, debounceMs: 200, onError, onDrain })

    writer.schedule()
    expect(() => writer.drain()).not.toThrow()
    expect(flush).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(error)
    expect(onDrain).not.toHaveBeenCalled()
  })
})
