// Persistence of the dependency *check* cache — what we last learned from the
// network, separate from the installed artifacts themselves. This file is pure
// cache: deleting it just makes the next launch re-check. The installed CLI's
// own identity (its release tag) lives in the binary's sidecar, not here, so it
// travels with the artifact.

import fs from 'fs'
import { writeJsonAtomic } from '../utils/atomic-write'
import { getDependenciesStatePath } from './paths'
import path from 'path'

export interface DependenciesCache {
  cli: {
    // The newest release tag seen by a successful check, so "update available"
    // survives a relaunch within the staleness cap without re-fetching.
    lastKnownLatest: string | null
    lastCheckedAtUtc: string | null
  }
  recommendations: {
    lastCheckedAtUtc: string | null
    // A fetched configs.json that differed from the installed one is staged as
    // the pending file; this flag records that an update is waiting to be applied.
    pending: boolean
  }
}

function emptyCache(): DependenciesCache {
  return {
    cli: { lastKnownLatest: null, lastCheckedAtUtc: null },
    recommendations: { lastCheckedAtUtc: null, pending: false },
  }
}

export function readDependenciesCache(): DependenciesCache {
  try {
    const raw = fs.readFileSync(getDependenciesStatePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<DependenciesCache>
    const base = emptyCache()
    return {
      cli: { ...base.cli, ...parsed.cli },
      recommendations: { ...base.recommendations, ...parsed.recommendations },
    }
  } catch {
    // Absent or malformed — start clean; the file is a rebuildable cache.
    return emptyCache()
  }
}

export function writeDependenciesCache(cache: DependenciesCache): void {
  fs.mkdirSync(path.dirname(getDependenciesStatePath()), { recursive: true })
  // not recorded: dependencies.json is a re-derivable dependency-check cache (last-known-latest
  // release tag, timestamps, a pending flag), not durable user-authored data — deleting it just
  // makes the next launch re-check (data-backup conventions: re-fetchable state is not recorded).
  writeJsonAtomic(getDependenciesStatePath(), cache, false)
}

/** Read, apply `mutate`, and persist in one step. */
export function updateDependenciesCache(
  mutate: (cache: DependenciesCache) => void
): DependenciesCache {
  const cache = readDependenciesCache()
  mutate(cache)
  writeDependenciesCache(cache)
  return cache
}
