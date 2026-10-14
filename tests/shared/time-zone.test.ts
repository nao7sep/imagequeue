import { describe, expect, it } from 'vitest'
import { isTimeZone, normalizeTimeZonePreference, resolveDisplayZone, timeZoneChoices } from '../../src/shared/time-zone'
import { createTranslator } from '../../src/shared/i18n/translate'
import { ENGLISH } from '../../src/shared/i18n/catalogues'

// The display zone (timestamp-conventions, Time zones).
describe('display zone', () => {
  it('keeps System and any IANA zone, and reads anything else as System', () => {
    expect(normalizeTimeZonePreference('system')).toBe('system')
    expect(normalizeTimeZonePreference('Asia/Tokyo')).toBe('Asia/Tokyo')
    for (const value of [undefined, null, '', 'Mars/Olympus', 42]) expect(normalizeTimeZonePreference(value)).toBe('system')
    expect(isTimeZone('Europe/Berlin')).toBe(true)
  })

  it('resolves System to the computer\'s zone, or UTC when it has none, and a chosen zone to itself', () => {
    expect(resolveDisplayZone('system', 'Asia/Tokyo')).toBe('Asia/Tokyo')
    expect(resolveDisplayZone('system', undefined)).toBe('UTC')
    expect(resolveDisplayZone('Europe/Berlin', 'Asia/Tokyo')).toBe('Europe/Berlin')
  })

  it('offers the platform\'s IANA zones', () => {
    expect(timeZoneChoices()).toContain('Asia/Tokyo')
    expect(timeZoneChoices()).toContain('America/New_York')
  })

  it('formats every time the translator shows in the display zone', () => {
    const instant = '2026-10-02T08:00:00.000Z'
    expect(createTranslator('en', ENGLISH, 'en-GB', 'Asia/Tokyo').dateTime(instant)).toContain('17:00')
    expect(createTranslator('en', ENGLISH, 'en-GB', 'UTC').dateTime(instant)).toContain('08:00')
  })
})
