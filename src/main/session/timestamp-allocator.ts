import { formatTimestamp } from './session'

// Per-backend timestamp allocator.
// Ensures uniqueness at second precision within a single backend.
// A mutex (via promise chain) prevents concurrent tasks from claiming the same second.
export class TimestampAllocator {
  private lastIssuedMs: number | null = null
  private lock: Promise<void> = Promise.resolve()

  // Reserves a unique timestamp for the given backend.
  // Waits (in 1-second increments) if the current second is already taken.
  async allocate(): Promise<string> {
    return new Promise<string>((resolve) => {
      this.lock = this.lock.then(async () => {
        const nowMs = Date.now()
        const currentSecondMs = Math.floor(nowMs / 1000) * 1000
        const nextMs = this.lastIssuedMs !== null && currentSecondMs <= this.lastIssuedMs
          ? this.lastIssuedMs + 1000
          : currentSecondMs
        const waitMs = nextMs - nowMs

        if (waitMs > 0) {
          await sleep(waitMs)
        }

        this.lastIssuedMs = nextMs
        resolve(formatTimestamp(new Date(nextMs)))
      })
    })
  }

  seed(timestampMs: number): void {
    if (this.lastIssuedMs === null || timestampMs > this.lastIssuedMs) {
      this.lastIssuedMs = timestampMs
    }
  }

  reset(): void {
    this.lastIssuedMs = null
    this.lock = Promise.resolve()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
