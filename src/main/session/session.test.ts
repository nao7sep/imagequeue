import { describe, expect, it } from 'vitest'
import { formatTimestamp } from './session'

describe('formatTimestamp', () => {
  it('formats a UTC date as yyyymmdd-hhmmss', () => {
    expect(formatTimestamp(new Date(Date.UTC(2026, 5, 4, 9, 30, 15)))).toBe('20260604-093015')
  })

  it('zero-pads single-digit month, day, and time fields', () => {
    expect(formatTimestamp(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe('20260102-030405')
  })

  it('uses UTC regardless of the local timezone', () => {
    // Epoch 0 is 1970-01-01T00:00:00Z.
    expect(formatTimestamp(new Date(0))).toBe('19700101-000000')
  })
})
