import { formatTimestamp } from './session'

// Per-backend timestamp allocator.
// Ensures uniqueness at second precision within a single backend.
// A mutex (via promise chain) prevents concurrent tasks from claiming the same second.
export class TimestampAllocator {
  private used = new Set<string>()
  private lock: Promise<void> = Promise.resolve()

  // Reserves a unique timestamp for the given backend.
  // Waits (in 1-second increments) if the current second is already taken.
  async allocate(): Promise<string> {
    return new Promise<string>((resolve) => {
      this.lock = this.lock.then(async () => {
        let ts = formatTimestamp(new Date())

        while (this.used.has(ts)) {
          await sleep(1000)
          ts = formatTimestamp(new Date())
        }

        this.used.add(ts)
        resolve(ts)
      })
    })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
