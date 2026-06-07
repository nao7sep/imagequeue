// A leading-edge coalescing writer for persistence that would otherwise run too
// often (e.g. once per keystroke). The first schedule() after an idle period
// arms a timer; further schedule() calls within the window are no-ops; when the
// timer fires, flush() runs once against the latest state. cancel() drops a
// pending flush without running it; drain() runs a pending flush immediately
// (used on quit, and before switching the thing being written). flush() errors
// are routed to onError so a throw inside the timer can't crash the process.
//
// Both the session-draft autosave and the Draw Things model-param autosave use
// this; keep new coalesced writers on it rather than re-rolling the timer.
export interface CoalescedWriter {
  schedule(): void
  cancel(): void
  drain(): void
}

export interface CoalescedWriterOptions {
  flush: () => void
  debounceMs: number
  // Called if flush() throws (from schedule's timer or drain). If omitted, the
  // error propagates to the caller, which for the timer path means an uncaught
  // exception — so persistence callers should supply this.
  onError?: (error: unknown) => void
  // Called after a drain() that successfully flushed a pending write — not when
  // drain() finds nothing pending, and not when the flush failed (that goes to
  // onError instead). Handy for a one-line "drained on quit" log without it
  // claiming success over a write that actually threw.
  onDrain?: () => void
}

export function createCoalescedWriter(options: CoalescedWriterOptions): CoalescedWriter {
  const { flush, debounceMs, onError, onDrain } = options
  let timer: ReturnType<typeof setTimeout> | null = null

  // Returns true if flush() completed, false if it threw and was routed to
  // onError. Rethrows when no onError is set (see onError's doc above).
  const runFlush = (): boolean => {
    try {
      flush()
      return true
    } catch (error) {
      if (!onError) throw error
      onError(error)
      return false
    }
  }

  return {
    schedule(): void {
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        runFlush()
      }, debounceMs)
    },
    cancel(): void {
      if (timer === null) return
      clearTimeout(timer)
      timer = null
    },
    drain(): void {
      if (timer === null) return
      clearTimeout(timer)
      timer = null
      if (runFlush()) onDrain?.()
    },
  }
}
