// Pure version comparison for the Draw Things CLI, kept free of I/O so it is
// directly unit-testable. The release tags are `v1.YYYYMMDD.N`; a `--HEAD`/source
// build reports `dev`, which has no comparable version.

import type { CliUpdateStatus } from '../shared/types'

/**
 * Parse a `1.YYYYMMDD.N` version into comparable numeric parts. Accepts it bare,
 * `v`-prefixed, or embedded in CLI output (e.g. `draw-things-cli 1.20260430.0`).
 * Returns null for anything without that shape — notably a `dev`/source build.
 */
export function parseCliVersion(version: string | null): number[] | null {
  if (!version) return null
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * Compare an installed version against the latest release tag. Returns `unknown`
 * when either side has no comparable version (offline, or a `dev` build) — never
 * a false `up-to-date` or `update-available`.
 */
export function compareCliVersions(
  installed: string | null,
  latest: string | null
): CliUpdateStatus['status'] {
  const current = parseCliVersion(installed)
  const newest = parseCliVersion(latest)
  if (!current || !newest) return 'unknown'
  for (let i = 0; i < 3; i++) {
    if (newest[i] > current[i]) return 'update-available'
    if (newest[i] < current[i]) return 'up-to-date'
  }
  return 'up-to-date'
}

/**
 * Extract the installed version from `brew list --versions <formula>` output,
 * which prints `<formula> <version> [<older-version>...]` for a brew-installed
 * formula, or nothing if it isn't installed via Homebrew. Returns the newest
 * (last) version token, or null when the formula isn't brew-managed. A `--HEAD`
 * install reports a `HEAD-...` token, which compareCliVersions treats as unknown.
 */
export function parseBrewListVersion(output: string): string | null {
  const line = output.trim().split('\n')[0]?.trim()
  if (!line) return null
  const parts = line.split(/\s+/)
  return parts.length >= 2 ? parts[parts.length - 1] : null
}
