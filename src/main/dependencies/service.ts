// The dependency orchestrator: assembles the surface state both the modal and the
// pane pointer read, runs checks (honoring the staleness cap at launch), and
// drives the CLI install/update. It composes the lower modules — release lookup,
// binary install, version compare, the configs.json module, the check cache — and
// is the only main-side entry point the IPC layer needs.

import { loadConfig } from '../config'
import { log, serializeError } from '../logger'
import { getRecommendationsStatus } from '../recommendations'
import { isCliInstalled, readInstalledCliTag, installCliRelease } from './cli-binary'
import { resolveLatestCliRelease } from './cli-release'
import { compareCliVersions } from './cli-version'
import { CLI_DOWNLOAD_LIMITS, withWholeOperationTimeout } from './download'
import {
  APP_DEPENDENCY_OPERATION_OWNER,
  DependencyOperationBusyError,
  runDependencyOperation,
} from './operations'
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
  const status = getRecommendationsStatus()
  const present = status.exists
  const installedLabel = !present
    ? null
    : status.valid
      ? `${status.entryCount} ${status.entryCount === 1 ? 'entry' : 'entries'}`
      : 'file unreadable'
  return {
    id: 'recommendations',
    // configs.json is mutable and versionless. Without upstream metadata there
    // is no honest read-only latest comparison, so presence remains unchecked
    // and the user may explicitly Refresh it whenever wanted.
    state: deriveDependencyState(present, 'unknown'),
    installedLabel,
    latestLabel: null,
    updatedAtUtc: status.updatedAt,
    lastCheckedAtUtc: null,
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

/** Check the CLI metadata now. The versionless recommendations file has no
 * metadata-only check and is acquired only by its explicit Install/Refresh. */
export async function checkAllDependencies(signal?: AbortSignal): Promise<DependenciesState> {
  await checkCliForUpdate(true, signal)
  return getDependenciesState()
}

/** The launch path: when the toggle is on, re-check CLI release metadata when
 * stale. Never fetches recommendation bytes and never throws. */
export async function checkDependenciesAtLaunch(): Promise<void> {
  // The CLI is macOS-only; on any other platform this would fetch GitHub
  // releases for a binary the machine cannot run and cache an "update
  // available" nobody can act on.
  if (process.platform !== 'darwin') return
  if (!checkUpdatesAtLaunch()) return
  const cache = readDependenciesCache()
  const now = Date.now()
  if (isCheckFresh(cache.cli.lastCheckedAtUtc, now)) return
  try {
    await runDependencyOperation(
      APP_DEPENDENCY_OPERATION_OWNER,
      ['cli'],
      (signal) => checkCliForUpdate(false, signal)
    )
  } catch (error) {
    if (error instanceof DependencyOperationBusyError) {
      log('info', 'Launch dependency check skipped; CLI operation already running')
    } else {
      log('warn', 'Launch dependency check failed', {
        dependency: 'Draw Things CLI',
        error: serializeError(error),
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
