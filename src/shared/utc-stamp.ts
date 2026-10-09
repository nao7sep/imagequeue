// The machine-paced UTC filename stamps, per the timestamp-conventions. Pure
// formatting over a Date, so main, the logger, and any test can share one
// implementation — this file imports nothing.
//
// Seconds are the precision for every name (timestamp-conventions): the
// per-image output allocator adds its own same-second ordinal, and sessions,
// logs and set-aside copies need nothing finer under the single-instance lock.
// utcStampForFilename adds the `-utc` suffix the conventions put on a name that
// stands alone as a file or folder (a session, a log, a set-aside copy), where
// the directory around it does not already say the time is UTC. Names an
// earlier version gave with milliseconds keep working wherever they are read.

export function formatTimestamp(date: Date): string {
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0')
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  )
}

export function utcStampForFilename(date: Date = new Date()): string {
  return `${formatTimestamp(date)}-utc`
}
