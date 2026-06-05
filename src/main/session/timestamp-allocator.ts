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

  // Seeds the last-issued second from a resumed session's existing output so new
  // allocations never predate it. Only the second is recovered, not the ordinal:
  // a new output landing in the exact same second as a resumed file (effectively
  // impossible after any real resume gap) would re-use an ordinal, which
  // writeImageOutput's overwrite guard catches as a thrown error, never a clobber.
  seed(timestampMs: number): void {
    if (this.lastSecondMs === null || timestampMs > this.lastSecondMs) {
      this.lastSecondMs = timestampMs
      this.lastOrdinal = 0
    }
  }

  reset(): void {
    this.lastSecondMs = null
    this.lastOrdinal = 0
  }
}
