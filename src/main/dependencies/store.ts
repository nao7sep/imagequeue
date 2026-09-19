// Persistence of the dependency *check* cache — what we last learned from the
// network, separate from the installed artifacts themselves. This file is pure
// cache: deleting it just makes the next launch re-check.
//
// Nothing here describes an artifact on disk, deliberately: the installed CLI's
// identity (its release tag) lives in the binary's sidecar, and configs.json
// carries its own as its modification time, so neither can drift from the
// artifact it describes (managed-runtime-dependencies-conventions). What is left
// is only what each check observed on the network and when, which have no
// on-disk source at all.

import fs from 'fs'
import { log, serializeError } from '../logger'
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
    // When the server's configs.json last changed (its Last-Modified), as seen
    // by a successful check. ISO-8601 UTC.
    lastKnownModifiedUtc: string | null
    lastCheckedAtUtc: string | null
  }
}

function emptyCache(): DependenciesCache {
  return {
    cli: { lastKnownLatest: null, lastCheckedAtUtc: null },
    recommendations: { lastKnownModifiedUtc: null, lastCheckedAtUtc: null },
  }
}

export function readDependenciesCache(): DependenciesCache {
  try {
    const raw = fs.readFileSync(getDependenciesStatePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<DependenciesCache>
    const base = emptyCache()
    return {
      cli: { ...base.cli, ...parsed.cli },
      // A pre-release store kept a bare check time here with no server time;
      // that fact is obsolete, and trusting it would skip a due check.
      recommendations:
        typeof parsed.recommendations?.lastKnownModifiedUtc === 'string'
          ? { ...base.recommendations, ...parsed.recommendations }
          : base.recommendations,
    }
  } catch (err) {
    // Absent is an expected probe (silent); present-but-unparseable is an
    // unexpected failure worth a trace before the silent rebuild.
    if (fs.existsSync(getDependenciesStatePath())) {
      log('warn', 'Ignoring unreadable dependencies.json; rebuilding the cache', { error: serializeError(err) })
    }
    return emptyCache()
  }
}

export function writeDependenciesCache(cache: DependenciesCache): void {
  fs.mkdirSync(path.dirname(getDependenciesStatePath()), { recursive: true })
  // not recorded: dependencies.json is a re-derivable network-facts cache (the last-known-latest
  // CLI release tag, configs.json's last-known server time, and last-successful-check times), not
  // durable user-authored data — deleting it just
  // makes the next launch re-check (data-backup conventions: re-fetchable caches are not recorded).
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
