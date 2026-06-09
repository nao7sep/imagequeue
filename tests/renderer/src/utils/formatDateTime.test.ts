import { describe, expect, it } from 'vitest'
import { formatUiDateTime } from '../../../../src/renderer/src/utils/formatDateTime'

// Display is local time (converted at the edge); pin a fixed, DST-free zone so
// the local-time output is deterministic regardless of where the suite runs.
process.env.TZ = 'Asia/Tokyo'

describe('formatUiDateTime', () => {
  it('formats a valid ISO instant as local yyyy-mm-dd hh:mm', () => {
    // 09:30 UTC is 18:30 in Asia/Tokyo (UTC+9); fails if it reverts to getUTC*.
    expect(formatUiDateTime('2026-06-04T09:30:15.000Z')).toBe('2026-06-04 18:30')
  })

  it('returns "n/a" for null', () => {
    expect(formatUiDateTime(null)).toBe('n/a')
  })

  it('returns the raw value when it is not a parseable date', () => {
    expect(formatUiDateTime('not a date')).toBe('not a date')
  })
})
