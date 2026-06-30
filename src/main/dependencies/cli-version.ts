// Pure version comparison for the Draw Things CLI, free of I/O so it is directly
// unit-testable. Release tags are `v1.YYYYMMDD.N`. The installed tag is the one
// recorded at download (the binary's --version is hardcoded `dev`), and latest is
// the newest release tag.

import type { DependencyComparison } from './state'

/**
 * Parse a `1.YYYYMMDD.N` version into comparable numeric parts. Accepts it bare,
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
