import { describe, expect, it } from 'vitest'
import { compareCliVersions, parseBrewListVersion, parseCliVersion } from '../../src/main/cli-version'

describe('parseCliVersion', () => {
  it('parses a bare, v-prefixed, or embedded version', () => {
    expect(parseCliVersion('1.20260430.0')).toEqual([1, 20260430, 0])
    expect(parseCliVersion('v1.20260430.0')).toEqual([1, 20260430, 0])
    expect(parseCliVersion('draw-things-cli 1.20260430.3')).toEqual([1, 20260430, 3])
  })

  it('returns null for a dev/source build, empty, or non-version text', () => {
    expect(parseCliVersion('dev')).toBeNull()
    expect(parseCliVersion('')).toBeNull()
    expect(parseCliVersion(null)).toBeNull()
    expect(parseCliVersion('unknown')).toBeNull()
  })
})

describe('compareCliVersions', () => {
  it('flags an update when the latest release is newer (by date or serial)', () => {
    expect(compareCliVersions('v1.20260430.0', 'v1.20260501.0')).toBe('update-available')
    expect(compareCliVersions('v1.20260430.0', 'v1.20260430.1')).toBe('update-available')
    expect(compareCliVersions('v1.20260430.0', 'v2.20260101.0')).toBe('update-available')
  })

  it('reports up-to-date when installed equals or exceeds the latest', () => {
    expect(compareCliVersions('v1.20260430.0', 'v1.20260430.0')).toBe('up-to-date')
    expect(compareCliVersions('v1.20260501.0', 'v1.20260430.0')).toBe('up-to-date')
  })

  it('compares parts in order: major, then date, then serial', () => {
    // Newer serial but older date must not count as an update.
    expect(compareCliVersions('v1.20260501.0', 'v1.20260430.9')).toBe('up-to-date')
  })

  it('is unknown when either side has no comparable version', () => {
    expect(compareCliVersions('dev', 'v1.20260430.0')).toBe('unknown') // --HEAD build
    expect(compareCliVersions('v1.20260430.0', null)).toBe('unknown') // offline / fetch failed
    expect(compareCliVersions(null, 'v1.20260430.0')).toBe('unknown') // not installed
    expect(compareCliVersions(null, null)).toBe('unknown')
  })
})

describe('parseBrewListVersion', () => {
  it('returns the version from `brew list --versions` output', () => {
    expect(parseBrewListVersion('draw-things-cli 1.20260430.0')).toBe('1.20260430.0')
    expect(parseBrewListVersion('  draw-things-cli 1.20260430.0\n')).toBe('1.20260430.0')
  })

  it('returns the newest (last) version when several are installed', () => {
    expect(parseBrewListVersion('draw-things-cli 1.20260418.1 1.20260430.0')).toBe('1.20260430.0')
  })

  it('returns null when the formula is not brew-installed (empty output)', () => {
    expect(parseBrewListVersion('')).toBeNull()
    expect(parseBrewListVersion('   \n')).toBeNull()
  })

  it('returns a HEAD token as-is, which then compares as unknown', () => {
    expect(parseBrewListVersion('draw-things-cli HEAD-abc1234')).toBe('HEAD-abc1234')
    expect(compareCliVersions(parseBrewListVersion('draw-things-cli HEAD-abc1234'), 'v1.20260430.0')).toBe(
      'unknown'
    )
  })
})
