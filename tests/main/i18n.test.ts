import { describe, expect, it } from 'vitest'
import { readSavedPreference } from '../../src/main/i18n'

// Main reads the saved language straight from config.json before anything is
// drawn; anything it cannot use follows the computer.
describe('readSavedPreference', () => {
  it('takes a supported tag from the general section', () => {
    expect(readSavedPreference(JSON.stringify({ general: { language: 'ja' } }))).toBe('ja')
    expect(readSavedPreference(JSON.stringify({ general: { language: 'zh-Hans' } }))).toBe('zh-Hans')
  })

  it('is System for a missing, unreadable, corrupt, or unknown value', () => {
    expect(readSavedPreference(null)).toBe('system')
    expect(readSavedPreference('{ not json')).toBe('system')
    expect(readSavedPreference(JSON.stringify({}))).toBe('system')
    expect(readSavedPreference(JSON.stringify({ general: { language: 'pt' } }))).toBe('system')
    expect(readSavedPreference(JSON.stringify({ general: { language: 'system' } }))).toBe('system')
  })
})
