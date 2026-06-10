export interface DrainSummary {
  ok: number
  failed: number
  durationMs: number
}

// Aggregates the outcome of one queue "drain" — a continuous busy period from
// the first task starting until the queue goes fully idle (nothing generating,
// nothing queued). The processor records each task's outcome here and emits a
// single info summary when the window closes, instead of one info line per
// image. This is the loops-aggregate rule from the logging conventions: count
// the successes, enumerate the failures (individually, at error), one info line
// per intent — never per item.
//
// Pure state with no I/O, so it unit-tests on its own and the processor keeps
// the logging side effect. A drain spans every backend at once: with concurrent
// backends several tasks run in parallel, and they all count into the same
// window, which only finalizes once the entire queue is idle.
export class DrainTracker {
  private startedAt: number | null = null
  private ok = 0
  private failed = 0

  // Opens a drain window on the idle→busy transition. A no-op once a window is
  // already open, so later task starts within the same busy period neither
  // reset the counts nor move the start time.
  begin(now: number): void {
    if (this.startedAt === null) {
      this.startedAt = now
      this.ok = 0
      this.failed = 0
    }
  }

  recordOk(): void {
    this.ok++
  }

  recordFailed(): void {
    this.failed++
  }

  // Closes the window and returns its summary only when a drain is open and the
  // queue is now idle; otherwise returns null and leaves the window untouched
  // (no drain open, or work still in flight/queued). Resets to idle after a
  // summary so the next busy period counts independently.
  finalize(now: number, idle: boolean): DrainSummary | null {
    if (this.startedAt === null || !idle) return null
    const summary: DrainSummary = {
      ok: this.ok,
      failed: this.failed,
      durationMs: now - this.startedAt,
    }
    this.startedAt = null
    this.ok = 0
    this.failed = 0
    return summary
  }
}
