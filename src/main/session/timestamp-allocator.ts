import { formatTimestamp } from './session'

export interface OutputTimestamp {
  // Second-precision UTC timestamp string (yyyymmdd-hhmmss).
  timestamp: string
  // 0 for the first output of a given second; increments for each subsequent
  // output in the same second. writeImageOutput appends it to the basename only
  // when > 0, so the common case keeps the plain `…-utc-slug-backend` name.
  ordinal: number
}

// Per-backend output-name allocator. Hands out a second-precision timestamp plus
// an ordinal that disambiguates multiple outputs landing in the same second
// (same backend + same slug is the only case that would otherwise collide).
//
// Allocation is synchronous: in single-threaded JS the read-modify-write of the
// allocator's state runs to completion without interleaving, so no mutex — and
// no stalling to the next second — is needed for uniqueness.
export class TimestampAllocator {
  private lastSecondMs: number | null = null
  private lastOrdinal = 0

  allocate(): OutputTimestamp {
    const nowSecondMs = Math.floor(Date.now() / 1000) * 1000
    // Never go backwards: if the clock is at or behind the last issued second
    // (same second, or a backward clock adjustment), stay on the last second and
    // bump the ordinal; otherwise start a fresh second at ordinal 0.
    const secondMs = this.lastSecondMs !== null ? Math.max(nowSecondMs, this.lastSecondMs) : nowSecondMs
    if (this.lastSecondMs !== null && secondMs === this.lastSecondMs) {
      this.lastOrdinal += 1
    } else {
      this.lastOrdinal = 0
    }
    this.lastSecondMs = secondMs
    return { timestamp: formatTimestamp(new Date(secondMs)), ordinal: this.lastOrdinal }
  }

  // Seeds the allocator from a resumed session's existing output so new
  // allocations continue past it. Recovers both the second and that second's
  // highest used ordinal, so a new output landing in the same second as resumed
  // files gets the next free ordinal instead of re-using one. Tasks may be
  // seeded in any order, so for the latest second we keep the max ordinal seen.
  seed(timestampMs: number, ordinal: number): void {
    if (this.lastSecondMs === null || timestampMs > this.lastSecondMs) {
      this.lastSecondMs = timestampMs
      this.lastOrdinal = ordinal
    } else if (timestampMs === this.lastSecondMs) {
      this.lastOrdinal = Math.max(this.lastOrdinal, ordinal)
    }
  }

  reset(): void {
    this.lastSecondMs = null
    this.lastOrdinal = 0
  }
}
