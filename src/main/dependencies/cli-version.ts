// Pure version comparison for the Draw Things CLI, free of I/O so it is directly
// unit-testable. Release tags were `v1.YYYYMMDD.N` until September 2026 and are
// `vYY.MMDD.N` from v26.0910.1 on. Both compare as three numbers, part by part,
// and every tag in the newer scheme leads with more than 1. The installed tag is
// the one recorded at download (the binary's --version is hardcoded `dev`), and
// latest is the newest release tag.

import type { DependencyComparison } from './state'

/** Whether a sidecar value is an actual release tag in either scheme, rather
 * than merely text containing a version-shaped fragment. */
export function isCliReleaseTag(value: string): boolean {
  return /^v?\d+\.\d+\.\d+$/.test(value)
}

/**
 * Parse a `1.YYYYMMDD.N` or `YY.MMDD.N` version into comparable numeric parts. Accepts it bare,
 * `v`-prefixed, or embedded (e.g. `draw-things-cli 1.20260430.0`). Returns null
 * for anything without that shape — notably a `dev`/source build.
 */
export function parseCliVersion(version: string | null): number[] | null {
  if (!version) return null
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * Compare an installed tag against the latest release tag. 'unknown' when either
 * side has no comparable version (offline, or never checked) — never a false
 * 'current' or 'outdated'.
 */
export function compareCliVersions(
  installed: string | null,
  latest: string | null
): DependencyComparison {
  const current = parseCliVersion(installed)
  const newest = parseCliVersion(latest)
  if (!current || !newest) return 'unknown'
  for (let i = 0; i < 3; i++) {
    if (newest[i] > current[i]) return 'outdated'
    if (newest[i] < current[i]) return 'current'
  }
  return 'current'
}
