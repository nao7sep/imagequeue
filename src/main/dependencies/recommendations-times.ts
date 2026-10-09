// The server time Install/Refresh recorded for each configs.json it published,
// kept under the storage root rather than beside the file, whose models folder
// Draw Things may share. Each entry is keyed by the file's path and holds the
// server's Last-Modified with the SHA-256 of the bytes it was served with, so the
// time never labels a file it was not served with.
//
// A re-derived cache (store-recovery-conventions): an unreadable file reads as
// empty and the next Install/Refresh replaces it. Its format version is written
// but never checked; overwriting a newer build's file loses only dates the next
// Install/Refresh records again.

import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { log, serializeError } from '../logger'
import { writeFileAtomicAsync } from '../utils/atomic-write'
import { FORMAT_VERSIONS, markFormat } from '../store-format'
import { getRecommendationsTimesPath } from './paths'

interface RecordedTime {
  /** The server's Last-Modified for the bytes Install/Refresh published. ISO-8601 UTC. */
  lastModifiedUtc: string
  /** SHA-256 of those bytes. */
  sha256: string
}

/** Absolute configs.json path → its recorded time. */
type RecordedTimes = Record<string, RecordedTime>

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isRecordedTime(value: unknown): value is RecordedTime {
  return isObject(value)
    && typeof value.sha256 === 'string'
    && typeof value.lastModifiedUtc === 'string'
    && !Number.isNaN(Date.parse(value.lastModifiedUtc))
}

function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

let unreadableWarned = false

/** The stored times, empty when the file is absent or unreadable. */
async function readTimes(): Promise<RecordedTimes> {
  const file = getRecommendationsTimesPath()
  try {
    const raw: unknown = JSON.parse(await fs.promises.readFile(file, 'utf8'))
    if (!isObject(raw)) throw new Error('must be a JSON object')
    const { files = {} } = raw
    if (!isObject(files) || !Object.values(files).every(isRecordedTime)) {
      throw new Error('files must map each configs.json path to its recorded time')
    }
    return files as RecordedTimes
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT' && !unreadableWarned) {
      unreadableWarned = true
      log('warn', 'Ignoring unreadable recommendations-times.json; the next Install or Refresh replaces it', { error: serializeError(err) })
    }
    return {}
  }
}

function keyOf(filePath: string): string {
  return path.resolve(filePath)
}

/** The server time recorded for the file's current bytes, or null when none was. */
export async function recordedServerTime(filePath: string): Promise<string | null> {
  const entry = (await readTimes())[keyOf(filePath)]
  if (!entry) return null
  try {
    return entry.sha256 === sha256Of(await fs.promises.readFile(filePath)) ? entry.lastModifiedUtc : null
  } catch {
    return null
  }
}

/** Record the server time for the bytes just published at filePath, or drop the
 * file's record when the server gave no valid time. */
export async function recordServerTime(filePath: string, bytes: Buffer, lastModifiedUtc: string | null): Promise<void> {
  const times = await readTimes()
  const key = keyOf(filePath)
  if (lastModifiedUtc) {
    times[key] = { lastModifiedUtc, sha256: sha256Of(bytes) }
  } else if (Object.hasOwn(times, key)) {
    delete times[key]
  } else {
    return
  }
  // not recorded: the times describe re-fetchable configs.json files and are rewritten by the
  // next Install/Refresh (data-backup conventions: re-fetchable dependencies are not recorded).
  await writeFileAtomicAsync(getRecommendationsTimesPath(), JSON.stringify(markFormat({ files: times }, FORMAT_VERSIONS.recommendationsTimes), null, 2), false)
}
