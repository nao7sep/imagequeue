import { describe, expect, it } from 'vitest'
import { parseTimestampMs } from '../../../src/main/session/output-timestamps'

describe('parseTimestampMs', () => {
  it('parses a leading yyyymmdd-hhmmss-utc basename as a UTC instant', () => {
    expect(parseTimestampMs('20260604-093015-utc-slug-openai'))
      .toBe(Date.UTC(2026, 5, 4, 9, 30, 15))
  })

  it('accepts a basename that is exactly the timestamp', () => {
    expect(parseTimestampMs('20260101-000000-utc')).toBe(Date.UTC(2026, 0, 1, 0, 0, 0))
  })

  it('returns null for null, empty, or non-matching names', () => {
    expect(parseTimestampMs(null)).toBeNull()
    expect(parseTimestampMs('')).toBeNull()
    expect(parseTimestampMs('no-timestamp-here')).toBeNull()
    // Missing the -utc marker required by the pattern.
    expect(parseTimestampMs('20260604-093015-slug')).toBeNull()
  })
})
