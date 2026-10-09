// Persistence of the dependency *check* cache — what we last learned from the
// network, separate from the installed artifacts themselves. This file is pure
// cache: deleting it just makes the next launch re-check.
//
// Nothing here describes an artifact on disk, deliberately: the installed CLI's
// identity (its release tag) lives in the binary's sidecar, and configs.json's
// (its server time) in recommendations-times.json with the hash of the bytes it
// describes, so neither can drift from the artifact it describes (managed-runtime-dependencies-conventions). What is left
// is only what each check observed on the network and when, which have no
// on-disk source at all.

import fs from 'fs'
import { log, serializeError } from '../logger'
import { writeFileAtomicAsync } from '../utils/atomic-write'
import { getDependenciesStatePath } from './paths'
import path from 'path'
import { FORMAT_VERSIONS, markFormat } from '../store-format'

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

// A cache: its format version is written but never checked; overwriting a
// newer build's file loses only what the next check re-learns
// (store-recovery-conventions).
export async function readDependenciesCache(): Promise<DependenciesCache> {
  const file = getDependenciesStatePath()
  try {
    const raw: unknown = JSON.parse(await fs.promises.readFile(file, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('dependencies.json must be a JSON object')
    const parsed = raw as Partial<DependenciesCache>
    const base = emptyCache()
    return {
      lastAttemptAtUtc: typeof parsed.lastAttemptAtUtc === 'string' ? parsed.lastAttemptAtUtc : null,
      cli: { ...base.cli, ...parsed.cli },
      recommendations: { ...base.recommendations, ...parsed.recommendations },
    }
  } catch (err) {
    // Absent is an expected probe (silent); present-but-unparseable is an
    // unexpected failure worth a trace before the silent rebuild.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log('warn', 'Ignoring unreadable dependencies.json; rebuilding the cache', { error: serializeError(err) })
    }
    return emptyCache()
  }
}

async function writeDependenciesCache(cache: DependenciesCache): Promise<void> {
  await fs.promises.mkdir(path.dirname(getDependenciesStatePath()), { recursive: true })
  // not recorded: dependencies.json is a re-derivable network-facts cache (the last-known-latest
  // CLI release tag, configs.json's last-known server time, the last check attempt, and last-successful-check times), not
  // durable user-authored data — deleting it just
  // makes the next launch re-check (data-backup conventions: re-fetchable caches are not recorded).
  await writeFileAtomicAsync(getDependenciesStatePath(), JSON.stringify(markFormat(cache, FORMAT_VERSIONS.dependencies), null, 2), false)
}

/** Read, apply `mutate`, and persist in one step. */
let saving: Promise<unknown> = Promise.resolve()
export function updateDependenciesCache(
  mutate: (cache: DependenciesCache) => void
): Promise<DependenciesCache> {
  const result = saving.catch(() => undefined).then(async () => {
    const cache = await readDependenciesCache()
    mutate(cache)
    await writeDependenciesCache(cache)
    return cache
  })
  saving = result
  return result
}
