// The dependency orchestrator: assembles the surface state both the modal and the
// pane pointer read, runs checks (throttling the launch check by the last attempt), and
// drives the CLI install/update. It composes the lower modules — release lookup,
// binary install, version compare, the configs.json module, the check cache — and
// is the only main-side entry point the IPC layer needs.

import { loadConfig } from '../config'
import { log, serializeError } from '../logger'
import { fetchLatestRecommendationsModified, getRecommendationsStatus } from '../recommendations'
import { isCliInstalled, readInstalledCliTag, installCliRelease } from './cli-binary'
import { resolveLatestCliRelease } from './cli-release'
import { compareCliVersions } from './cli-version'
import { CLI_DOWNLOAD_LIMITS, withWholeOperationTimeout } from './download'
import {
  APP_DEPENDENCY_OPERATION_OWNER,
  DependencyOperationBusyError,
  runDependencyOperation,
  type MutableDependency,
} from './operations'
import {
  compareRecommendations,
  deriveDependencyState,
  isLaunchCheckDue,
  type DependencyComparison,
} from './state'
import { readDependenciesCache, updateDependenciesCache } from './store'
import type { DependenciesState, DependencyInfo, DependencyProgress } from '../../shared/types'

function checkUpdatesAtLaunch(): boolean {
  return loadConfig().image_backends.drawthings.check_updates_at_launch
}

function cliInfo(): DependencyInfo {
  const cache = readDependenciesCache()
  const present = isCliInstalled()
  const installedTag = readInstalledCliTag()
  const latest = cache.cli.lastKnownLatest
  const comparison: DependencyComparison = present
    ? compareCliVersions(installedTag, latest)
    : 'unknown'
  return {
    id: 'cli',
    state: deriveDependencyState(present, comparison),
    installedLabel: installedTag,
    latestLabel: latest,
    entryCount: null,
    updatedAtUtc: null,
    lastCheckedAtUtc: cache.cli.lastCheckedAtUtc,
  }
}

function recommendationsInfo(): DependencyInfo {
  const cache = readDependenciesCache()
  const status = getRecommendationsStatus()
  const present = status.exists
  // configs.json has no version; its identity is when the server last changed
  // it, recorded with the hash of its bytes (see recommendations-times).
  const comparison: DependencyComparison = present
    ? compareRecommendations(status.updatedAt, cache.recommendations.lastKnownModifiedUtc)
    : 'unknown'
  return {
    id: 'recommendations',
    state: deriveDependencyState(present, comparison),
    installedLabel: null,
    latestLabel: null,
    entryCount: present && status.valid ? status.entryCount : null,
    updatedAtUtc: status.updatedAt,
    lastCheckedAtUtc: cache.recommendations.lastCheckedAtUtc,
  }
}

export function getDependenciesState(): DependenciesState {
  return {
    cli: cliInfo(),
    recommendations: recommendationsInfo(),
    checkUpdatesAtLaunch: checkUpdatesAtLaunch(),
    platformSupported: process.platform === 'darwin',
  }
}

/** Resolve the latest CLI release and record the result (newest tag + checked-at)
 * in the cache. `force` re-fetches past the per-process cache. */
async function checkCliForUpdate(force: boolean, signal?: AbortSignal): Promise<void> {
  const release = await resolveLatestCliRelease(force, signal)
  // A failed lookup (offline, rate-limited, non-200) resolves null and must write
  // NO persisted fact (invariant I3): advancing the timestamp here would read as
  // "checked just now" having learned nothing.
  if (!release) throw new Error('Could not reach the Draw Things release server')
  updateDependenciesCache((cache) => {
    cache.cli.lastCheckedAtUtc = new Date().toISOString()
    cache.cli.lastKnownLatest = release.tag
  })
}

/** Ask the server when configs.json last changed, and record it with the
 * check time. A failed request records nothing (invariant I3). */
async function checkRecommendationsForUpdate(signal?: AbortSignal): Promise<void> {
  const modified = await fetchLatestRecommendationsModified(signal)
  updateDependenciesCache((cache) => {
    cache.recommendations.lastCheckedAtUtc = new Date().toISOString()
    cache.recommendations.lastKnownModifiedUtc = modified
  })
}

function recordCheckAttempt(): void {
  updateDependenciesCache((cache) => {
    cache.lastAttemptAtUtc = new Date().toISOString()
  })
}

/** Check every managed tool now, without installing anything. Each success is
 * recorded even when the other check fails; any failure is then reported. */
export async function checkAllDependencies(signal?: AbortSignal): Promise<DependenciesState> {
  recordCheckAttempt()
  const results = await Promise.allSettled([
    checkCliForUpdate(true, signal),
    checkRecommendationsForUpdate(signal),
  ])
  const failure = results.find((result) => result.status === 'rejected')
  if (failure) throw failure.reason
  return getDependenciesState()
}

// One best-effort launch check in its own slot, so an explicit operation on the
// other tool still runs. A busy slot skips the check; a failure is logged.
async function checkAtLaunch(
  dependency: MutableDependency,
  name: string,
  run: (signal: AbortSignal) => Promise<void>
): Promise<void> {
  try {
    await runDependencyOperation(APP_DEPENDENCY_OPERATION_OWNER, [dependency], run)
  } catch (error) {
    if (error instanceof DependencyOperationBusyError) {
      log('info', 'Launch dependency check skipped; operation already running', { dependency: name })
    } else {
      log('warn', 'Launch dependency check failed', {
        dependency: name,
        error: serializeError(error),
      })
    }
  }
}

/** The launch path: when the toggle is on and the last attempt is a day old,
 * check the CLI's release metadata, and configs.json's server time when the
 * file is present. Never fetches recommendation bytes and never throws. */
export async function checkDependenciesAtLaunch(): Promise<void> {
  // The CLI is macOS-only; on any other platform this would fetch GitHub
  // releases for a binary the machine cannot run and cache an "update
  // available" nobody can act on.
  if (process.platform !== 'darwin') return
  if (!checkUpdatesAtLaunch()) return
  if (!isLaunchCheckDue(readDependenciesCache().lastAttemptAtUtc, Date.now())) return
  try {
    recordCheckAttempt()
  } catch (error) {
    // A check whose attempt cannot be recorded could not record its result either.
    log('warn', 'Launch dependency check skipped; the check attempt could not be recorded', {
      error: serializeError(error),
    })
    return
  }
  const checks = [checkAtLaunch('cli', 'Draw Things CLI', (signal) => checkCliForUpdate(false, signal))]
  // An absent optional file reads "Not installed" whatever the server holds.
  if (getRecommendationsStatus().exists) {
    checks.push(checkAtLaunch('recommendations', 'Recommended parameters', checkRecommendationsForUpdate))
  }
  await Promise.all(checks)
}

/**
 * Install the latest CLI release, or update an installed one to it — the same
 * operation (download newest), so callers don't distinguish. Reports progress.
 * Throws when the release can't be resolved or the install fails (see
 * installCliRelease); on success records the installed tag as the latest seen.
 */
export async function installOrUpdateCli(
  onProgress?: (progress: DependencyProgress) => void,
  signal?: AbortSignal
): Promise<DependenciesState> {
  return withWholeOperationTimeout(
    signal,
    CLI_DOWNLOAD_LIMITS.wholeTimeoutMs,
    'CLI acquisition',
    async (boundedSignal) => {
      const release = await resolveLatestCliRelease(true, boundedSignal)
      if (!release) {
        throw new Error('Could not reach the Draw Things release server')
      }
      await installCliRelease(release, onProgress, boundedSignal)
      updateDependenciesCache((cache) => {
        cache.cli.lastKnownLatest = release.tag
        cache.cli.lastCheckedAtUtc = new Date().toISOString()
      })
      return getDependenciesState()
    }
  )
}
