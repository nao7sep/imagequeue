// Persistence of the dependency *check* cache — what we last learned from the
// network, separate from the installed artifacts themselves. This file is pure
// cache: deleting it just makes the next launch re-check.
//
// Nothing here describes an artifact on disk, deliberately: the installed CLI's
// identity (its release tag) lives in the binary's sidecar, and configs.json's
// (its server time) in the sidecar beside it, so neither can drift from the
// artifact it describes (managed-runtime-dependencies-conventions). What is left
// is only what each check observed on the network and when, which have no
// on-disk source at all.

import fs from 'fs'
import { log, serializeError } from '../logger'
import { writeJsonAtomic } from '../utils/atomic-write'
import { getDependenciesStatePath } from './paths'
import path from 'path'
import { checkFormat, FORMAT_VERSIONS, markFormat, NewerFormatError } from '../store-format'

export interface DependenciesCache {
  // When any check, automatic or manual, last started; it throttles the launch
  // check whether or not that check succeeded. ISO-8601 UTC.
  lastAttemptAtUtc: string | null
  cli: {
    // The newest release tag seen by a successful check, so "update available"
    // survives a relaunch between launch checks without re-fetching.
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
    lastAttemptAtUtc: null,
    cli: { lastKnownLatest: null, lastCheckedAtUtc: null },
    recommendations: { lastKnownModifiedUtc: null, lastCheckedAtUtc: null },
  }
}

interface StoredCache {
  cache: DependenciesCache
  // False for a file a newer build wrote: it is read as empty and never
  // written (store-recovery-conventions), so every launch checks afresh.
  writable: boolean
}

let newerWarned = false

function readStoredCache(): StoredCache {
  const file = getDependenciesStatePath()
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('dependencies.json must be a JSON object')
    const parsed = checkFormat(raw as Record<string, unknown>, FORMAT_VERSIONS.dependencies, file) as Partial<DependenciesCache>
    const base = emptyCache()
    return {
      writable: true,
      cache: {
        lastAttemptAtUtc: typeof parsed.lastAttemptAtUtc === 'string' ? parsed.lastAttemptAtUtc : null,
        cli: { ...base.cli, ...parsed.cli },
        recommendations: { ...base.recommendations, ...parsed.recommendations },
      },
    }
  } catch (err) {
    if (err instanceof NewerFormatError) {
      if (!newerWarned) {
        newerWarned = true
        log('warn', 'dependencies.json is from a newer version; checking afresh and leaving it unchanged', { error: serializeError(err) })
      }
      return { cache: emptyCache(), writable: false }
    }
    // Absent is an expected probe (silent); present-but-unparseable is an
    // unexpected failure worth a trace before the silent rebuild.
    if (fs.existsSync(file)) {
      log('warn', 'Ignoring unreadable dependencies.json; rebuilding the cache', { error: serializeError(err) })
    }
    return { cache: emptyCache(), writable: true }
  }
}

export function readDependenciesCache(): DependenciesCache {
  return readStoredCache().cache
}

function writeDependenciesCache(cache: DependenciesCache): void {
  fs.mkdirSync(path.dirname(getDependenciesStatePath()), { recursive: true })
  // not recorded: dependencies.json is a re-derivable network-facts cache (the last-known-latest
  // CLI release tag, configs.json's last-known server time, the last check attempt, and last-successful-check times), not
  // durable user-authored data — deleting it just
  // makes the next launch re-check (data-backup conventions: re-fetchable caches are not recorded).
  writeJsonAtomic(getDependenciesStatePath(), markFormat(cache, FORMAT_VERSIONS.dependencies), false)
}

/** Read, apply `mutate`, and persist in one step. */
export function updateDependenciesCache(
  mutate: (cache: DependenciesCache) => void
): DependenciesCache {
  const stored = readStoredCache()
  mutate(stored.cache)
  if (stored.writable) writeDependenciesCache(stored.cache)
  return stored.cache
}
