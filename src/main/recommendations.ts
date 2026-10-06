// The recommended-parameters file (configs.json) — one of the two managed Draw
// Things dependencies. It has no version, but the server reports when it last
// changed (Last-Modified), and that time is its identity: Install/Refresh
// validates and atomically publishes the file, then records that time with the
// file's hash in a sidecar beside it, and a check asks the server for its time
// alone (an HTTP HEAD) without fetching the bytes. A file the sidecar does not
// describe, or one served without a valid Last-Modified, has no known server
// time; its own modification time is never taken for it. The generation path
// reads it via resolveRecommendedParams; everything else is dependency management.

import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { writeFileAtomicAsync, writeJsonAtomic } from './utils/atomic-write'
import { log, serializeError } from './logger'
import { checkFormat, FORMAT_VERSIONS, markFormat, NewerFormatError } from './store-format'
import { resolveModelsDir, ensureModelsDir } from './local-cli'
import type { IncomingHttpHeaders } from 'http'
import {
  fetchBytesWithHeaders,
  fetchHeaders,
  RECOMMENDATIONS_LIMITS,
  RELEASE_METADATA_LIMITS,
  withWholeOperationTimeout,
} from './dependencies/download'
import {
  RecommendedParams,
  RecommendationStatus
} from '../shared/types'
import {
  RecommendationSpec,
  findRecommendedSettings,
  parseRecommendationBytes,
  recommendedParamsFromMatch
} from './recommendation-match'

const RECOMMENDATIONS_URL = 'https://models.drawthings.ai/configs.json'
const RECOMMENDATIONS_FILE = 'configs.json'
const RECOMMENDATIONS_META_FILE = 'configs.imagequeue.json'

interface RecommendationsMeta {
  /** The server's Last-Modified for the bytes Install/Refresh published. ISO-8601 UTC. */
  lastModifiedUtc: string
  /** SHA-256 of those bytes, so the time never labels a file it was not served with. */
  sha256: string
}

// configs.json lives in the effective models dir, alongside Draw Things' own
// custom.json — its natural home, and shared with the GUI app's models when the
// user points models_dir there.
export function getRecommendationsPath(): string {
  return path.join(resolveModelsDir(), RECOMMENDATIONS_FILE)
}

export function getRecommendationsMetaPath(): string {
  return path.join(resolveModelsDir(), RECOMMENDATIONS_META_FILE)
}

function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

let newerWarned = false

/** The server time recorded for the file's current bytes, or null when none was. */
function readServerModified(filePath: string): string | null {
  const metaPath = getRecommendationsMetaPath()
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const meta = checkFormat(raw as Record<string, unknown>, FORMAT_VERSIONS.recommendationsSidecar, metaPath) as Partial<RecommendationsMeta>
    if (typeof meta.lastModifiedUtc !== 'string' || Number.isNaN(Date.parse(meta.lastModifiedUtc))) return null
    if (typeof meta.sha256 !== 'string') return null
    return meta.sha256 === sha256Of(fs.readFileSync(filePath)) ? meta.lastModifiedUtc : null
  } catch (err) {
    if (err instanceof NewerFormatError && !newerWarned) {
      newerWarned = true
      log('warn', 'The recommended parameters sidecar is from a newer version; its date reads as unknown', { error: serializeError(err) })
    }
    return null
  }
}

// A newer build's sidecar stays exactly as it is (store-recovery conventions);
// the refusal names the file.
function refuseNewerRecommendationsMeta(): void {
  const metaPath = getRecommendationsMetaPath()
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  } catch {
    return
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  try {
    checkFormat(raw as Record<string, unknown>, FORMAT_VERSIONS.recommendationsSidecar, metaPath)
  } catch (err) {
    if (err instanceof NewerFormatError) throw err
  }
}

export function getRecommendationsStatus(): RecommendationStatus {
  const filePath = getRecommendationsPath()
  if (!fs.existsSync(filePath)) {
    return { exists: false, valid: false, entryCount: 0, updatedAt: null }
  }

  const parsed = parseRecommendationFile(filePath)
  return {
    exists: true,
    valid: parsed.error === null,
    entryCount: parsed.specs.length,
    updatedAt: readServerModified(filePath)
  }
}

/** Explicitly install or refresh configs.json. The whole transaction is bounded,
 * cancellable through durable staging, and never runs from launch or Check. */
export function downloadLatestRecommendations(signal?: AbortSignal): Promise<RecommendationStatus> {
  return withWholeOperationTimeout(
    signal,
    3 * 60 * 1000,
    'Recommendations acquisition',
    async (boundedSignal) => {
      refuseNewerRecommendationsMeta()
      const { body: data, headers } = await fetchBytesWithHeaders(
        RECOMMENDATIONS_URL,
        RECOMMENDATIONS_LIMITS,
        boundedSignal
      )
      validateRecommendationBytes(data)
      boundedSignal.throwIfAborted()

      ensureModelsDir()
      const filePath = getRecommendationsPath()
      // not recorded: configs.json is a re-fetchable managed dependency downloaded verbatim from
      // models.drawthings.ai, living in the effective models dir alongside Draw Things' own model data
      // (not under ~/.imagequeue/) — re-acquirable content the app reads, not durable user-authored text
      // (data-backup conventions: re-fetchable dependencies are not recorded).
      await writeFileAtomicAsync(filePath, data, false, boundedSignal)
      // The sidecar records the server's time for these bytes, so a later check
      // can tell whether the server has changed the file since. Without a valid
      // header the file's server time is unknown, and no sidecar describes it.
      const serverModified = lastModifiedOf(headers)
      const metaPath = getRecommendationsMetaPath()
      if (serverModified) {
        const meta: RecommendationsMeta = { lastModifiedUtc: serverModified, sha256: sha256Of(data) }
        // not recorded: the sidecar describes the re-fetchable configs.json it sits beside and is
        // rewritten by the next Install/Refresh (data-backup conventions: re-fetchable dependencies
        // are not recorded).
        writeJsonAtomic(metaPath, markFormat(meta, FORMAT_VERSIONS.recommendationsSidecar), false)
      } else {
        fs.rmSync(metaPath, { force: true })
      }
      return getRecommendationsStatus()
    }
  )
}

/** When the server's configs.json last changed, asked for with its headers
 * alone. Throws when the server cannot be reached or does not say. */
export async function fetchLatestRecommendationsModified(signal?: AbortSignal): Promise<string> {
  const headers = await fetchHeaders(RECOMMENDATIONS_URL, RELEASE_METADATA_LIMITS, signal)
  const modified = lastModifiedOf(headers)
  if (!modified) throw new Error('The recommended parameters server did not report when the file changed')
  return modified
}

/** A response's Last-Modified as ISO-8601 UTC, or null when absent or invalid. */
export function lastModifiedOf(headers: IncomingHttpHeaders): string | null {
  const raw = headers['last-modified']
  if (typeof raw !== 'string') return null
  const time = Date.parse(raw)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

export function resolveRecommendedParams(model: string): RecommendedParams | null {
  const parsed = parseRecommendationFile(getRecommendationsPath())
  if (parsed.error !== null || parsed.specs.length === 0) return null
  const match = findRecommendedSettings(model, parsed.specs)
  if (!match) return null
  return recommendedParamsFromMatch(match)
}

function validateRecommendationBytes(data: Buffer): void {
  if (parseRecommendationBytes(data).length === 0) {
    throw new Error('Recommendation file is not valid configs.json')
  }
}

function parseRecommendationFile(filePath: string): { specs: RecommendationSpec[]; error: string | null } {
  try {
    const specs = parseRecommendationBytes(fs.readFileSync(filePath))
    return { specs, error: specs.length === 0 ? 'No recommendation entries found' : null }
  } catch (err) {
    return { specs: [], error: (err as Error).message }
  }
}
