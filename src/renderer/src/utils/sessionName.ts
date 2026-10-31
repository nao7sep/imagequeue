// A session's id is its folder name: a UTC date and time and a `-utc` suffix,
// as in `20260919-091256-utc`. On screen a session is named
// by that moment shown in the display zone (timestamp-conventions), never by
// the bare UTC digits, which read as a local time; the id itself, and every
// path and lookup built from it, keep the whole name.
const SESSION_ID = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-utc$/

export function sessionStartTime(sessionId: string): Date | null {
  const match = SESSION_ID.exec(sessionId)
  if (!match) return null
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number)
  const time = new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!, second!))
  // Date.UTC rolls an impossible date over; such a name is not a session time.
  const exact = time.getUTCFullYear() === year && time.getUTCMonth() === month! - 1 && time.getUTCDate() === day
    && time.getUTCHours() === hour && time.getUTCMinutes() === minute && time.getUTCSeconds() === second
  return exact ? time : null
}

/** The session's start, formatted by the caller in the display zone; an id
 *  that is not a session time shows as itself. */
export function sessionDisplayName(sessionId: string, format: (time: Date) => string): string {
  const time = sessionStartTime(sessionId)
  return time ? format(time) : sessionId
}
