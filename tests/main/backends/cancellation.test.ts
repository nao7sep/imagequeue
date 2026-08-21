import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cancelAllInFlight,
  cancelAllInFlightAndWait,
  cancelInFlight,
  clearInFlight,
  inFlightCount,
  isQueuePaused,
  registerInFlight,
  resetCancellationState,
  setQueuePaused,
} from '../../../src/main/backends/cancellation'

// Nothing in this app could stop image generation before this registry existed:
// the processor polls every 500ms and starts any queued task, and the work
// itself was unreachable (a child process handle inside its own promise, cloud
// requests with no abort signal). These tests pin the two things that make
// stopping possible — a reachable canceller per running task, and a flag the
// poller honours.

afterEach(() => resetCancellationState())

describe('in-flight registry', () => {
  it('cancels one running generation and leaves the others alone', () => {
    const a = vi.fn(); const b = vi.fn()
    registerInFlight('t1', a, Promise.resolve())
    registerInFlight('t2', b, Promise.resolve())
    expect(cancelInFlight('t1')).toBe(true)
    expect(a).toHaveBeenCalledOnce()
    expect(b).not.toHaveBeenCalled()
  })

  it('reports false for a task that is not running', () => {
    expect(cancelInFlight('nope')).toBe(false)
  })

  it('cancels everything in flight and counts what it signalled', () => {
    registerInFlight('t1', vi.fn(), Promise.resolve())
    registerInFlight('t2', vi.fn(), Promise.resolve())
    expect(cancelAllInFlight()).toBe(2)
  })

  it('does not finish the shutdown barrier before generation settles', async () => {
    let resolveSettled!: () => void
    const settled = new Promise<void>((resolve) => { resolveSettled = resolve })
    const cancel = vi.fn()
    registerInFlight('t1', cancel, settled)

    const waiting = cancelAllInFlightAndWait(1_000)
    let finished = false
    void waiting.then(() => { finished = true })
    await Promise.resolve()
    expect(cancel).toHaveBeenCalledOnce()
    expect(finished).toBe(false)

    resolveSettled()
    await expect(waiting).resolves.toEqual({ signalled: 1, settled: true })
  })

  // A generation that finishes normally must not stay cancellable: a later
  // "stop everything" would otherwise signal a process that is long gone.
  it('stops tracking a generation once it clears', () => {
    registerInFlight('t1', vi.fn(), Promise.resolve())
    clearInFlight('t1')
    expect(inFlightCount()).toBe(0)
    expect(cancelInFlight('t1')).toBe(false)
  })

  // One backend's canceller throwing must not abandon the rest — a half-stopped
  // queue is worse than either outcome.
  it('keeps cancelling after one canceller throws', () => {
    const boom = vi.fn(() => { throw new Error('already dead') })
    const ok = vi.fn()
    registerInFlight('t1', boom, Promise.resolve())
    registerInFlight('t2', ok, Promise.resolve())
    expect(cancelAllInFlight()).toBe(2)
    expect(ok).toHaveBeenCalledOnce()
  })
})

describe('queue pause flag', () => {
  it('starts unpaused and toggles', () => {
    expect(isQueuePaused()).toBe(false)
    setQueuePaused(true)
    expect(isQueuePaused()).toBe(true)
    setQueuePaused(false)
    expect(isQueuePaused()).toBe(false)
  })

  // Pausing must not touch running work: the whole point is that the current
  // image finishes and saves rather than being thrown away.
  it('does not cancel anything in flight', () => {
    const cancel = vi.fn()
    registerInFlight('t1', cancel, Promise.resolve())
    setQueuePaused(true)
    expect(cancel).not.toHaveBeenCalled()
    expect(inFlightCount()).toBe(1)
  })
})
