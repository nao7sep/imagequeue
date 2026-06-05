import { describe, expect, it } from 'vitest'
import { parseTimestampMs, parseOutputOrdinal } from '../../../src/main/session/output-timestamps'
import { outputBaseName } from '../../../src/main/utils/file-output'

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

describe('parseOutputOrdinal', () => {
  it('returns 0 for a basename with no ordinal suffix', () => {
    expect(parseOutputOrdinal('20260604-093015-utc-cat-drawthings', 'drawthings')).toBe(0)
  })

  it('recovers the ordinal from a 1-based suffix', () => {
    expect(parseOutputOrdinal('20260604-093015-utc-cat-drawthings-2', 'drawthings')).toBe(1)
    expect(parseOutputOrdinal('20260604-093015-utc-cat-drawthings-3', 'drawthings')).toBe(2)
  })

  it('returns 0 for null or a non-matching backend', () => {
    expect(parseOutputOrdinal(null, 'openai')).toBe(0)
    expect(parseOutputOrdinal('20260604-093015-utc-cat-drawthings-2', 'openai')).toBe(0)
  })

  it('is the exact inverse of outputBaseName for every backend/ordinal', () => {
    for (const backend of ['openai', 'imagen', 'drawthings'] as const) {
      for (const ordinal of [0, 1, 5, 41]) {
        const name = outputBaseName('20260604-093015', ordinal, 'a-slug', backend)
        expect(parseOutputOrdinal(name, backend)).toBe(ordinal)
      }
    }
  })

  it('is not fooled by a numeric slug or a slug echoing the backend token', () => {
    // Numeric slug, ordinal 1: only the trailing -{backend}-{N} is the ordinal.
    expect(parseOutputOrdinal(outputBaseName('20260604-093015', 1, '2', 'openai'), 'openai')).toBe(1)
    // Slug ends with the backend word; the real backend token is still last.
    const tricky = outputBaseName('20260604-093015', 0, 'x-openai-5', 'openai')
    expect(parseOutputOrdinal(tricky, 'openai')).toBe(0)
  })
})
