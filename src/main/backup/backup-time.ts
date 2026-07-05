/**
 * Whole-second UTC time helpers for the backup index. Sub-second precision is deliberately dropped: the
 * modification time is compared with a two-second tolerance (see the data-backup conventions), so it
 * carries no fractional component and stays portable across filesystems (FAT/exFAT are 2-second).
 */

/** A whole-second UTC ISO-8601 stamp (`yyyy-MM-ddTHH:mm:ssZ`) from an epoch-milliseconds value. */
export function toIsoSeconds(msSinceEpoch: number): string {
  return new Date(msSinceEpoch).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** Truncate an epoch-milliseconds value to the whole second. */
export function truncateToSecondMs(msSinceEpoch: number): number {
  return Math.floor(msSinceEpoch / 1000) * 1000
}

/** The archive/index run stamp (`yyyymmdd-hhmmss-fff-utc`, machine-paced per the timestamp-conventions)
 *  for a run at `now`; also the zip stem (`backup-<archivedAt>.zip`) and each new index entry's
 *  `archivedAt`. Records written before milliseconds were adopted carry the second-precision
 *  `yyyymmdd-hhmmss-utc` form and stay valid as-is — nothing migrates them. */
export function formatArchivedAt(now: Date): string {
  const y = now.getUTCFullYear()
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const h = String(now.getUTCHours()).padStart(2, '0')
  const mi = String(now.getUTCMinutes()).padStart(2, '0')
  const s = String(now.getUTCSeconds()).padStart(2, '0')
  const ms = String(now.getUTCMilliseconds()).padStart(3, '0')
  return `${y}${mo}${d}-${h}${mi}${s}-${ms}-utc`
}
