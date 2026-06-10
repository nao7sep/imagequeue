import { describe, expect, it } from 'vitest'
import { ImeGuard } from '../../../../src/renderer/src/utils/imeGuard'

// A manual scheduler stands in for requestAnimationFrame so the one-tick hold
// after compositionend is deterministic in a plain node env.
function manualScheduler(): {
  scheduler: { schedule: (cb: () => void) => number; cancel: (handle: number) => void }
  tick: () => void
  pending: () => boolean
} {
  let queued: (() => void) | null = null
  let handle = 0
  return {
    scheduler: {
      schedule(cb: () => void): number {
        queued = cb
        return ++handle
      },
      cancel(): void {
        queued = null
      }
    },
    tick(): void {
      const cb = queued
      queued = null
      cb?.()
    },
    pending(): boolean {
      return queued !== null
    }
  }
}

describe('ImeGuard', () => {
  it('is not composing before any composition starts', () => {
    const { scheduler } = manualScheduler()
    expect(new ImeGuard(scheduler).isComposing()).toBe(false)
  })

  it('reports composing from start until the post-end tick fires', () => {
    const m = manualScheduler()
    const guard = new ImeGuard(m.scheduler)
    guard.start()
    expect(guard.isComposing()).toBe(true)
    guard.end()
    // WebKit can deliver the final Enter keydown AFTER compositionend; the guard
    // must still report composing until the next tick, then clear.
    expect(guard.isComposing()).toBe(true)
    m.tick()
    expect(guard.isComposing()).toBe(false)
  })

  it('cancels the stale end-tick when a new composition starts before it fires', () => {
    const m = manualScheduler()
    const guard = new ImeGuard(m.scheduler)
    guard.start()
    guard.end()
    guard.start() // user begins a new candidate before the tick fires
    expect(m.pending()).toBe(false) // the stale end-tick was cancelled
    m.tick() // even a spurious fire must not clear the new composition
    expect(guard.isComposing()).toBe(true)
  })

  it('ends composition immediately on cancel and drops any pending end-tick', () => {
    const m = manualScheduler()
    const guard = new ImeGuard(m.scheduler)
    guard.start()
    guard.end()
    expect(m.pending()).toBe(true)
    guard.cancel()
    expect(guard.isComposing()).toBe(false)
    expect(m.pending()).toBe(false)
    m.tick()
    expect(guard.isComposing()).toBe(false)
  })

  it('does not get stuck composing when compositionend is skipped but focus leaves', () => {
    const m = manualScheduler()
    const guard = new ImeGuard(m.scheduler)
    guard.start()
    // No end() — the browser skipped compositionend; focusout drives cancel().
    guard.cancel()
    expect(guard.isComposing()).toBe(false)
  })

  it('honors per-event signals when no composition is tracked', () => {
    const { scheduler } = manualScheduler()
    const guard = new ImeGuard(scheduler)
    expect(guard.isComposing({ isComposing: true })).toBe(true)
    expect(guard.isComposing({ isComposing: false })).toBe(false)
    // Legacy WebKit "IME processing" sentinel.
    expect(guard.isComposing({ isComposing: false, keyCode: 229 })).toBe(true)
    expect(guard.isComposing({ keyCode: 229 })).toBe(true)
    // Plain Enter (keyCode 13) outside composition must submit.
    expect(guard.isComposing({ isComposing: false, keyCode: 13 })).toBe(false)
    // A browser that dropped the deprecated keyCode simply falls through.
    expect(guard.isComposing({ keyCode: undefined })).toBe(false)
  })
})
