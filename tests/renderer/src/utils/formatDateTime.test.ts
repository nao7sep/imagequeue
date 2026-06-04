import { describe, expect, it } from 'vitest'
import { formatUiDateTime } from '../../../../src/renderer/src/utils/formatDateTime'

describe('formatUiDateTime', () => {
  it('formats a valid ISO instant as yyyy-mm-dd hh:mm UTC', () => {
    expect(formatUiDateTime('2026-06-04T09:30:15.000Z')).toBe('2026-06-04 09:30 UTC')
  })

  it('returns "n/a" for null', () => {
    expect(formatUiDateTime(null)).toBe('n/a')
  })

  it('returns the raw value when it is not a parseable date', () => {
    expect(formatUiDateTime('not a date')).toBe('not a date')
  })
})
