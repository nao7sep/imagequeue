// The machine-paced UTC filename stamps, per the timestamp-conventions. Pure
// formatting over a Date, so main, the logger, and any test can share one
// implementation — this file imports nothing.
//
// Two precisions, because two different things need naming:
//   formatTimestamp   yyyymmdd-hhmmss       — the per-image output allocator,
//                                             which paces uniqueness with its
//                                             own same-second ordinal.
//   formatTimestampMs yyyymmdd-hhmmss-fff   — everything whose uniqueness comes
//                                             from the clock alone.
// utcStampForFilename adds the `-utc` suffix the conventions put on a name that
// stands alone as a file (a log, a quarantined file), where the directory around
// it does not already say the time is UTC.

export function formatTimestamp(date: Date): string {
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0')
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  )
}

export function formatTimestampMs(date: Date): string {
  return `${formatTimestamp(date)}-${String(date.getUTCMilliseconds()).padStart(3, '0')}`
}

export function utcStampForFilename(date: Date = new Date()): string {
  return `${formatTimestampMs(date)}-utc`
}
