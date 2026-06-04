import { describe, expect, it } from 'vitest'
import { shouldDeleteToTrash, shouldDropEmptySessions } from '../../src/shared/config'

// Both settings default to "on" (the safer behavior) for any value except an
// explicit false — including undefined/null from an older config that predates
// the setting.
describe('shouldDeleteToTrash / shouldDropEmptySessions', () => {
  it('returns true for everything except an explicit false', () => {
    for (const fn of [shouldDeleteToTrash, shouldDropEmptySessions]) {
      expect(fn(true)).toBe(true)
      expect(fn(undefined)).toBe(true)
      expect(fn(null)).toBe(true)
      expect(fn(false)).toBe(false)
    }
  })
})
