// A session's id is its folder name: a UTC date and time and a `-utc` suffix,
// as in `20260919-091256-utc`; folders an earlier version made also carry
// milliseconds, as in `20260919-091256-888-utc`. On screen the suffix and any
// milliseconds are noise, so the shown name is the date and time alone; the id
// itself, and every path and lookup built from it, keep the whole name.
export function sessionDisplayName(sessionId: string): string {
  return sessionId.replace(/^(\d{8}-\d{6})(?:-\d{3})?-utc$/, '$1')
}
