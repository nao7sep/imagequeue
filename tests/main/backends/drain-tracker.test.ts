import { describe, expect, it } from 'vitest'
import { DrainTracker } from '../../../src/main/backends/drain-tracker'

describe('DrainTracker', () => {
  it('returns null when finalized with no drain open', () => {
    const tracker = new DrainTracker()
    expect(tracker.finalize(500, true)).toBeNull()
  })

  it('counts ok and failed across a drain and finalizes once idle', () => {
    const tracker = new DrainTracker()
    tracker.begin(1000)
    tracker.recordOk()
    tracker.recordOk()
    tracker.recordFailed()
    // Still busy: no summary yet.
    expect(tracker.finalize(1500, false)).toBeNull()
    expect(tracker.finalize(2000, true)).toEqual({ ok: 2, failed: 1, durationMs: 1000 })
  })

  it('keeps the window open (no reset) while not idle', () => {
    const tracker = new DrainTracker()
    tracker.begin(0)
    tracker.recordOk()
    expect(tracker.finalize(100, false)).toBeNull()
    // The same count and start time finalize once idle, proving the not-idle
    // call left the window untouched.
    expect(tracker.finalize(250, true)).toEqual({ ok: 1, failed: 0, durationMs: 250 })
  })

  it('treats begin as idempotent within an open drain', () => {
    const tracker = new DrainTracker()
    tracker.begin(1000)
    tracker.recordOk()
    tracker.begin(1234) // second begin mid-drain: must not reset counts or move the start
    tracker.recordFailed()
    expect(tracker.finalize(3000, true)).toEqual({ ok: 1, failed: 1, durationMs: 2000 })
  })

  it('resets after a summary so the next drain counts independently', () => {
    const tracker = new DrainTracker()
    tracker.begin(1000)
    tracker.recordOk()
    expect(tracker.finalize(1500, true)).toEqual({ ok: 1, failed: 0, durationMs: 500 })

    // A fresh drain reuses the same tracker with zeroed counts and a new start.
    tracker.begin(2000)
    tracker.recordFailed()
    tracker.recordFailed()
    expect(tracker.finalize(2300, true)).toEqual({ ok: 0, failed: 2, durationMs: 300 })
  })
})
