import { describe, expect, it } from 'vitest'
import { compareCliVersions, parseCliVersion } from '../../../src/main/dependencies/cli-version'

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
    expect(compareCliVersions('v1.20260430.0', 'v1.20260501.0')).toBe('outdated')
    expect(compareCliVersions('v1.20260430.0', 'v1.20260430.1')).toBe('outdated')
    expect(compareCliVersions('v1.20260430.0', 'v2.20260101.0')).toBe('outdated')
  })

  it('reports current when installed equals or exceeds the latest', () => {
    expect(compareCliVersions('v1.20260430.0', 'v1.20260430.0')).toBe('current')
    expect(compareCliVersions('v1.20260501.0', 'v1.20260430.0')).toBe('current')
  })

  it('compares parts in order: major, then date, then serial', () => {
    // Newer serial but older date must not count as an update.
    expect(compareCliVersions('v1.20260501.0', 'v1.20260430.9')).toBe('current')
  })

  it('is unknown when either side has no comparable version', () => {
    expect(compareCliVersions('dev', 'v1.20260430.0')).toBe('unknown') // --HEAD build
    expect(compareCliVersions('v1.20260430.0', null)).toBe('unknown') // offline / fetch failed
    expect(compareCliVersions(null, 'v1.20260430.0')).toBe('unknown') // not installed
    expect(compareCliVersions(null, null)).toBe('unknown')
  })
})
