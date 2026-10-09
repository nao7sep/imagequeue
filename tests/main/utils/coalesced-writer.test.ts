import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCoalescedWriter } from '../../../src/main/utils/coalesced-writer'

describe('coalesced required writes', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('coalesces edits and drains immediately without a duplicate timer write', async () => {
    const flush = vi.fn(), writer = createCoalescedWriter({ flush, debounceMs: 200 })
    writer.schedule(); writer.schedule()
    await writer.drain()
    await vi.advanceTimersByTimeAsync(200)
    expect(flush).toHaveBeenCalledOnce()
  })
  it('retains timer failures for quit drain and propagates failures until Retry succeeds', async () => {
    const flush = vi.fn().mockRejectedValueOnce(new Error('full')).mockRejectedValueOnce(new Error('full')).mockResolvedValue(undefined)
    const onError = vi.fn(), writer = createCoalescedWriter({ flush, onError, debounceMs: 200 })
    writer.schedule()
    await vi.advanceTimersByTimeAsync(200)
    await expect(writer.drain()).rejects.toThrow('full')
    await writer.drain()
    await writer.drain()
    expect(flush).toHaveBeenCalledTimes(3)
    expect(onError).toHaveBeenCalledTimes(2)
  })
  it('holds the physical write and saves later edits after it settles', async () => {
    let finish!: () => void
    const flush = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve })).mockResolvedValue(undefined)
    const writer = createCoalescedWriter({ flush, debounceMs: 200 })
    writer.schedule()
    await vi.advanceTimersByTimeAsync(200)
    writer.schedule()
    const drained = writer.drain()
    expect(flush).toHaveBeenCalledOnce()
    finish()
    await drained
    expect(flush).toHaveBeenCalledTimes(2)
  })
  it('cancels a pending edit without writing', async () => {
    const flush = vi.fn(), writer = createCoalescedWriter({ flush, debounceMs: 200 })
    writer.schedule(); writer.cancel()
    await writer.drain()
    expect(flush).not.toHaveBeenCalled()
  })
})
