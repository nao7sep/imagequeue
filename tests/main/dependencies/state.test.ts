import { describe, expect, it } from 'vitest'
import {
  deriveDependencyState,
  isCheckFresh,
  STALENESS_CAP_MS,
} from '../../../src/main/dependencies/state'

describe('deriveDependencyState', () => {
  it('is not-installed when absent, regardless of comparison', () => {
    expect(deriveDependencyState(false, 'current')).toBe('not-installed')
    expect(deriveDependencyState(false, 'outdated')).toBe('not-installed')
    expect(deriveDependencyState(false, 'unknown')).toBe('not-installed')
  })

  it('maps a present dependency by its comparison verdict', () => {
    expect(deriveDependencyState(true, 'outdated')).toBe('update-available')
    expect(deriveDependencyState(true, 'current')).toBe('up-to-date')
    expect(deriveDependencyState(true, 'unknown')).toBe('installed-unchecked')
  })
})

describe('isCheckFresh', () => {
  const now = Date.parse('2026-06-30T12:00:00.000Z')

  it('is false for a null or unparseable timestamp', () => {
    expect(isCheckFresh(null, now)).toBe(false)
    expect(isCheckFresh('not a date', now)).toBe(false)
  })

  it('is true within the cap and false at or beyond it', () => {
    const justUnder = new Date(now - (STALENESS_CAP_MS - 60_000)).toISOString()
    const exactlyCap = new Date(now - STALENESS_CAP_MS).toISOString()
    const wellPast = new Date(now - 2 * STALENESS_CAP_MS).toISOString()
    expect(isCheckFresh(justUnder, now)).toBe(true)
    expect(isCheckFresh(exactlyCap, now)).toBe(false)
    expect(isCheckFresh(wellPast, now)).toBe(false)
  })

  it('uses a 24-hour cap', () => {
    expect(STALENESS_CAP_MS).toBe(24 * 60 * 60 * 1000)
  })
})
