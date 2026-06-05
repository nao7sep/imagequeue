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
    // Seed the current second as already used by a resumed output.
    alloc.seed(Date.UTC(2026, 5, 4, 9, 30, 15))
    expect(alloc.allocate()).toEqual({ timestamp: '20260604-093015', ordinal: 1 })
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
