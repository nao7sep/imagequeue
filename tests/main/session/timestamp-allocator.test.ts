import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimestampAllocator } from '../../../src/main/session/timestamp-allocator'

// The allocator hands out a second-precision timestamp plus an ordinal that
// disambiguates outputs landing in the same second, without stalling. These
// tests use a fixed system clock; no real or fake timers are advanced because
// allocation is synchronous and never waits.
describe('TimestampAllocator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 4, 9, 30, 15)))
  })
  afterEach(() => vi.useRealTimers())

  it('issues the current second at ordinal 0 on the first allocation', () => {
    const alloc = new TimestampAllocator()
    expect(alloc.allocate()).toEqual({ timestamp: '20260604-093015', ordinal: 0 })
  })

  it('keeps the same second and increments the ordinal within one second', () => {
    const alloc = new TimestampAllocator()
    expect(alloc.allocate()).toEqual({ timestamp: '20260604-093015', ordinal: 0 })
    expect(alloc.allocate()).toEqual({ timestamp: '20260604-093015', ordinal: 1 })
    expect(alloc.allocate()).toEqual({ timestamp: '20260604-093015', ordinal: 2 })
  })

  it('resets the ordinal to 0 when the clock advances to a new second', () => {
    const alloc = new TimestampAllocator()
    expect(alloc.allocate()).toEqual({ timestamp: '20260604-093015', ordinal: 0 })
    expect(alloc.allocate()).toEqual({ timestamp: '20260604-093015', ordinal: 1 })
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 4, 9, 30, 16)))
    expect(alloc.allocate()).toEqual({ timestamp: '20260604-093016', ordinal: 0 })
  })

  it('never predates a seeded second: bumps the ordinal instead', () => {
    const alloc = new TimestampAllocator()
    // Seed the current second as already used (ordinal 0) by a resumed output.
    alloc.seed(Date.UTC(2026, 5, 4, 9, 30, 15), 0)
    expect(alloc.allocate()).toEqual({ timestamp: '20260604-093015', ordinal: 1 })
  })

  it('continues past the highest seeded ordinal for a resumed second', () => {
    const alloc = new TimestampAllocator()
    // Resumed files in this second used ordinals 0..2 (basename suffix -3).
    alloc.seed(Date.UTC(2026, 5, 4, 9, 30, 15), 2)
    expect(alloc.allocate()).toEqual({ timestamp: '20260604-093015', ordinal: 3 })
  })

  it('keeps the max ordinal when a second is seeded out of order', () => {
    const alloc = new TimestampAllocator()
    const S = Date.UTC(2026, 5, 4, 9, 30, 15)
    alloc.seed(S, 0)
    alloc.seed(S, 3)
    alloc.seed(S, 1)
    expect(alloc.allocate()).toEqual({ timestamp: '20260604-093015', ordinal: 4 })
  })

  it('ignores ordinals seeded for an older second than the latest', () => {
    const alloc = new TimestampAllocator()
    alloc.seed(Date.UTC(2026, 5, 4, 9, 30, 16), 0) // newer second
    alloc.seed(Date.UTC(2026, 5, 4, 9, 30, 15), 5) // older second, higher ordinal
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 4, 9, 30, 16)))
    // Allocation lands in the newer seeded second, so it continues from ordinal 0.
    expect(alloc.allocate()).toEqual({ timestamp: '20260604-093016', ordinal: 1 })
  })

  it('does not go backwards when the clock rewinds within a second', () => {
    const alloc = new TimestampAllocator()
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 4, 9, 30, 16)))
    expect(alloc.allocate()).toEqual({ timestamp: '20260604-093016', ordinal: 0 })
    // Clock steps back a second; the allocator holds its last second.
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 4, 9, 30, 15)))
    expect(alloc.allocate()).toEqual({ timestamp: '20260604-093016', ordinal: 1 })
  })

  it('clears all state on reset', () => {
    const alloc = new TimestampAllocator()
    expect(alloc.allocate()).toEqual({ timestamp: '20260604-093015', ordinal: 0 })
    alloc.reset()
    // After reset the same second is available again at ordinal 0.
    expect(alloc.allocate()).toEqual({ timestamp: '20260604-093015', ordinal: 0 })
  })
})
