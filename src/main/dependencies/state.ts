// The pure mapping from raw facts to one of the four dependency lifecycle states,
// kept free of I/O so it is directly unit-testable. Both dependencies derive
// their state through this one function: the caller reduces its specifics (a
// version comparison for the CLI, a byte-compare result for configs.json) to a
// `comparison` verdict, and presence to a boolean.

import type { DependencyState } from '../../shared/types'

// How long a successful check is trusted before the launch path re-runs it. An
// app constant, not a setting — see the managed-runtime-dependencies convention.
export const STALENESS_CAP_MS = 24 * 60 * 60 * 1000

export type DependencyComparison = 'current' | 'outdated' | 'unknown'

/**
 * Derive the lifecycle state. `comparison` is 'unknown' when latest could not be
 * established (offline, check disabled and never run, or a versionless artifact
 * never checked), which for a present dependency means "installed, not checked".
 */
export function deriveDependencyState(
  present: boolean,
  comparison: DependencyComparison
): DependencyState {
  if (!present) return 'not-installed'
  if (comparison === 'outdated') return 'update-available'
  if (comparison === 'current') return 'up-to-date'
  return 'installed-unchecked'
}

/** Whether a check recorded at `lastCheckedAtUtc` is still within the staleness
 * cap relative to `nowMs`. A null/unparseable timestamp is always stale, so the
 * launch path re-checks. */
export function isCheckFresh(lastCheckedAtUtc: string | null, nowMs: number): boolean {
  if (!lastCheckedAtUtc) return false
  const checkedMs = Date.parse(lastCheckedAtUtc)
  if (Number.isNaN(checkedMs)) return false
  return nowMs - checkedMs < STALENESS_CAP_MS
}
