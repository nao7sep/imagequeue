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
  const comparison: DependencyComparison = cache.recommendations.pending
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
async function checkCliForUpdate(force: boolean): Promise<void> {
  const release = await resolveLatestCliRelease(force)
  updateDependenciesCache((cache) => {
    cache.cli.lastCheckedAtUtc = new Date().toISOString()
    if (release) cache.cli.lastKnownLatest = release.tag
  })
}

/** Run both dependency checks now (the modal's "Check for updates"). */
export async function checkAllDependencies(): Promise<DependenciesState> {
  await Promise.allSettled([checkCliForUpdate(true), checkRecommendations()])
  return getDependenciesState()
}

/** The launch path: when the toggle is on, re-check each dependency whose last
 * check is older than the staleness cap. Never throws — a failed check just
 * leaves that dependency 'installed-unchecked'. */
export async function checkDependenciesAtLaunch(): Promise<void> {
  if (!checkUpdatesAtLaunch()) return
  const cache = readDependenciesCache()
  const now = Date.now()
  const tasks: Promise<unknown>[] = []
  if (!isCheckFresh(cache.cli.lastCheckedAtUtc, now)) tasks.push(checkCliForUpdate(false))
  if (!isCheckFresh(cache.recommendations.lastCheckedAtUtc, now)) tasks.push(checkRecommendations())
  if (tasks.length === 0) return
  try {
    await Promise.allSettled(tasks)
  } catch (err) {
    log('warn', 'Launch dependency check failed', { error: serializeError(err) })
  }
}

/**
 * Install the latest CLI release, or update an installed one to it — the same
 * operation (download newest), so callers don't distinguish. Reports progress.
 * Throws when the release can't be resolved or the install fails (see
 * installCliRelease); on success records the installed tag as the latest seen.
 */
export async function installOrUpdateCli(
  onProgress?: (progress: DependencyProgress) => void
): Promise<DependenciesState> {
  const release = await resolveLatestCliRelease(true)
  if (!release) {
    throw new Error('Could not reach the Draw Things release server')
  }
  await installCliRelease(release, onProgress)
  updateDependenciesCache((cache) => {
    cache.cli.lastKnownLatest = release.tag
    cache.cli.lastCheckedAtUtc = new Date().toISOString()
  })
  return getDependenciesState()
}
