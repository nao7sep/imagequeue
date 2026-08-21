// The dependency orchestrator: assembles the surface state both the modal and the
// pane pointer read, runs checks (honoring the staleness cap at launch), and
// drives the CLI install/update. It composes the lower modules — release lookup,
// binary install, version compare, the configs.json module, the check cache — and
// is the only main-side entry point the IPC layer needs.

import { loadConfig } from '../config'
import { log, serializeError } from '../logger'
import {
  checkRecommendations,
  getRecommendationsStatus,
  hasPendingRecommendationsUpdate,
} from '../recommendations'
import { isCliInstalled, readInstalledCliTag, installCliRelease } from './cli-binary'
import { resolveLatestCliRelease } from './cli-release'
import { compareCliVersions } from './cli-version'
import { deriveDependencyState, isCheckFresh, type DependencyComparison } from './state'
import { readDependenciesCache, updateDependenciesCache } from './store'
import type { DependenciesState, DependencyInfo, DependencyProgress } from '../../shared/types'

function checkUpdatesAtLaunch(): boolean {
  return loadConfig().image_backends.drawthings.check_updates_at_launch
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
    updatedAtUtc: null,
    lastCheckedAtUtc: cache.cli.lastCheckedAtUtc,
  }
}

function recommendationsInfo(): DependencyInfo {
  const cache = readDependenciesCache()
  const status = getRecommendationsStatus()
  const present = status.exists
  const everChecked = cache.recommendations.lastCheckedAtUtc !== null
  // "An update is waiting" is read from the staged file, not from a recorded
  // flag — same rule as the CLI's tag: the fact lives with the artifact.
  const comparison: DependencyComparison = hasPendingRecommendationsUpdate()
    ? 'outdated'
    : everChecked
      ? 'current'
      : 'unknown'
  const installedLabel = !present
    ? null
    : status.valid
      ? `${status.entryCount} ${status.entryCount === 1 ? 'entry' : 'entries'}`
      : 'file unreadable'
  return {
    id: 'recommendations',
    state: deriveDependencyState(present, comparison),
    installedLabel,
    latestLabel: null,
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
  // "checked just now" having learned nothing, and suppress re-checks for 24h.
  if (!release) throw new Error('Could not reach the Draw Things release server')
  updateDependenciesCache((cache) => {
    cache.cli.lastCheckedAtUtc = new Date().toISOString()
    cache.cli.lastKnownLatest = release.tag
  })
}

/** Run both dependency checks now (the modal's "Check for updates"). */
export async function checkAllDependencies(signal?: AbortSignal): Promise<DependenciesState> {
  const checks = [
    { label: 'Draw Things CLI', promise: checkCliForUpdate(true, signal) },
    { label: 'Recommended parameters', promise: checkRecommendations(signal) },
  ]
  const results = await Promise.allSettled(checks.map((check) => check.promise))
  signal?.throwIfAborted()
  const failures = results.flatMap((result, index) =>
    result.status === 'rejected'
      ? [`${checks[index].label}: ${errorMessage(result.reason)}`]
      : []
  )
  if (failures.length > 0) {
    throw new Error(`Could not check dependencies. ${failures.join('; ')}`)
  }
  return getDependenciesState()
}

/** The launch path: when the toggle is on, re-check each dependency whose last
 * check is older than the staleness cap. Never throws — a failed check just
 * leaves that dependency 'installed-unchecked'. */
export async function checkDependenciesAtLaunch(): Promise<void> {
  // The CLI and its recommendations are macOS-only; on any other platform this
  // would fetch GitHub releases for a binary the machine cannot run and cache
  // an "update available" nobody can act on.
  if (process.platform !== 'darwin') return
  if (!checkUpdatesAtLaunch()) return
  const cache = readDependenciesCache()
  const now = Date.now()
  const tasks: Array<{ label: string; promise: Promise<unknown> }> = []
  if (!isCheckFresh(cache.cli.lastCheckedAtUtc, now)) {
    tasks.push({ label: 'Draw Things CLI', promise: checkCliForUpdate(false) })
  }
  if (!isCheckFresh(cache.recommendations.lastCheckedAtUtc, now)) {
    tasks.push({ label: 'Recommended parameters', promise: checkRecommendations() })
  }
  if (tasks.length === 0) return
  const results = await Promise.allSettled(tasks.map((task) => task.promise))
  for (let index = 0; index < results.length; index++) {
    const result = results[index]
    if (result.status === 'rejected') {
      log('warn', 'Launch dependency check failed', {
        dependency: tasks[index].label,
        error: serializeError(result.reason),
      })
    }
  }
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
  const release = await resolveLatestCliRelease(true, signal)
  if (!release) {
    throw new Error('Could not reach the Draw Things release server')
  }
  await installCliRelease(release, onProgress, signal)
  updateDependenciesCache((cache) => {
    cache.cli.lastKnownLatest = release.tag
    cache.cli.lastCheckedAtUtc = new Date().toISOString()
  })
  return getDependenciesState()
}
