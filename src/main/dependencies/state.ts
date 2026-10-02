// The pure mapping from raw facts to one of the four dependency lifecycle states,
// kept free of I/O so it is directly unit-testable. Both dependencies derive
// their state through this one function: the caller reduces its specifics (a
// version comparison for the CLI, a byte-compare result for configs.json) to a
// `comparison` verdict, and presence to a boolean.

import type { DependencyState } from '../../shared/types'

// How long the launch check waits after the last attempt. An app constant, not
// a setting — see the managed-runtime-dependencies convention.
export const LAUNCH_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

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

/** Whether the launch check is due, given the last check attempt: when that
 * time is missing, unparseable, in the future, or at least the interval old. */
export function isLaunchCheckDue(lastAttemptAtUtc: string | null, nowMs: number): boolean {
  if (!lastAttemptAtUtc) return true
  const attemptMs = Date.parse(lastAttemptAtUtc)
  if (Number.isNaN(attemptMs) || attemptMs > nowMs) return true
  return nowMs - attemptMs >= LAUNCH_CHECK_INTERVAL_MS
}

/**
 * Compare the local configs.json with the server's by modification time.
 * Install/Refresh stamps the file with the server's Last-Modified, so a current
 * copy carries exactly that time and a copy from before the server's last change
 * carries an earlier one. A file written before stamping began carries its
 * download time instead, which is later than any server change it was fetched
 * after, so it too reads current. 'unknown' when either time is missing.
 */
export function compareRecommendations(
  localModifiedUtc: string | null,
  latestModifiedUtc: string | null
): DependencyComparison {
  if (!localModifiedUtc || !latestModifiedUtc) return 'unknown'
  const local = Date.parse(localModifiedUtc)
  const latest = Date.parse(latestModifiedUtc)
  if (Number.isNaN(local) || Number.isNaN(latest)) return 'unknown'
  // HTTP dates carry whole seconds; a stamped file's milliseconds are zero.
  return Math.floor(local / 1000) >= Math.floor(latest / 1000) ? 'current' : 'outdated'
}
