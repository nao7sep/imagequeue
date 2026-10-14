// The display zone (timestamp-conventions, Time zones): every time ImageQueue
// shows, in every window, is shown in it. 'system' follows the computer's zone
// on every launch; otherwise it is an IANA zone chosen from the list. ImageQueue
// reads no times without a zone, so it has no interpretation zone.

export type TimeZonePreference = 'system' | string

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** A missing or unusable stored value resolves to System. */
export function normalizeTimeZonePreference(value: unknown): TimeZonePreference {
  return value === 'system' || isTimeZone(value) ? value : 'system'
}

/** The computer's zone, or undefined when the platform does not report one. */
export function systemTimeZone(): string | undefined {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return isTimeZone(zone) ? zone : undefined
}

/** The zone times are shown in: System falls back to UTC when the computer's
 *  zone is unavailable. */
export function resolveDisplayZone(preference: TimeZonePreference, system: string | undefined): string {
  if (preference !== 'system') return preference
  return system ?? 'UTC'
}

/** The zones offered after System, from the platform's own IANA list. */
export function timeZoneChoices(): string[] {
  return Intl.supportedValuesOf('timeZone')
}
