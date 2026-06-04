import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimestampAllocator } from './timestamp-allocator'

// The allocator guarantees second-unique timestamps per backend; a collision
// would make writeImageOutput throw "refusing to overwrite". These tests pin
// that guarantee using fake timers so no real wall-clock waiting occurs.
describe('TimestampAllocator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 4, 9, 30, 15)))
  })
  afterEach(() => vi.useRealTimers())

  it('issues the current second on the first allocation', async () => {
    const alloc = new TimestampAllocator()
    await expect(alloc.allocate()).resolves.toBe('20260604-093015')
  })

  it('advances to the next second when the current one is already taken', async () => {
    const alloc = new TimestampAllocator()
    const first = alloc.allocate()
    const second = alloc.allocate()
    await vi.runAllTimersAsync()
    expect(await first).toBe('20260604-093015')
    expect(await second).toBe('20260604-093016')
  })

  it('never reuses a seeded second', async () => {
    const alloc = new TimestampAllocator()
    // Seed the current second as already used.
    alloc.seed(Date.UTC(2026, 5, 4, 9, 30, 15))
    const next = alloc.allocate()
    await vi.runAllTimersAsync()
    expect(await next).toBe('20260604-093016')
  })

  it('clears all state on reset', async () => {
    const alloc = new TimestampAllocator()
    await alloc.allocate() // claims 093015
    alloc.reset()
    // After reset the same second is available again.
    await expect(alloc.allocate()).resolves.toBe('20260604-093015')
  })
})
