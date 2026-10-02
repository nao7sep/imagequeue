import { describe, expect, it } from 'vitest'
import {
  compareRecommendations,
  deriveDependencyState,
  isLaunchCheckDue,
  LAUNCH_CHECK_INTERVAL_MS,
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

describe('isLaunchCheckDue', () => {
  const now = Date.parse('2026-06-30T12:00:00.000Z')

  it('is due for a missing, unparseable or future attempt', () => {
    expect(isLaunchCheckDue(null, now)).toBe(true)
    expect(isLaunchCheckDue('not a date', now)).toBe(true)
    expect(isLaunchCheckDue(new Date(now + 60_000).toISOString(), now)).toBe(true)
  })

  it('waits within the interval and is due at or beyond it', () => {
    const justUnder = new Date(now - (LAUNCH_CHECK_INTERVAL_MS - 60_000)).toISOString()
    const exactly = new Date(now - LAUNCH_CHECK_INTERVAL_MS).toISOString()
    const wellPast = new Date(now - 2 * LAUNCH_CHECK_INTERVAL_MS).toISOString()
    expect(isLaunchCheckDue(new Date(now).toISOString(), now)).toBe(false)
    expect(isLaunchCheckDue(justUnder, now)).toBe(false)
    expect(isLaunchCheckDue(exactly, now)).toBe(true)
    expect(isLaunchCheckDue(wellPast, now)).toBe(true)
  })

  it('uses a 24-hour interval', () => {
    expect(LAUNCH_CHECK_INTERVAL_MS).toBe(24 * 60 * 60 * 1000)
  })
})

describe('compareRecommendations', () => {
  const server = '2026-09-11T20:46:05.000Z'

  it('reads a file stamped with the server time as current', () => {
    expect(compareRecommendations(server, server)).toBe('current')
  })

  it('reads a file from before the server last changed it as outdated', () => {
    expect(compareRecommendations('2026-08-22T20:13:13.000Z', server)).toBe('outdated')
  })

  it('reads a file written after the server last changed it as current', () => {
    // A download from before stamping began keeps its own write time.
    expect(compareRecommendations('2026-09-19T11:29:40.512Z', server)).toBe('current')
  })

  it('ignores the milliseconds an HTTP date cannot carry', () => {
    expect(compareRecommendations('2026-09-11T20:46:05.000Z', '2026-09-11T20:46:05.900Z')).toBe('current')
  })

  it('is unknown before any check, or when either time is unreadable', () => {
    expect(compareRecommendations(server, null)).toBe('unknown')
    expect(compareRecommendations(null, server)).toBe('unknown')
    expect(compareRecommendations('not a date', server)).toBe('unknown')
  })
})
