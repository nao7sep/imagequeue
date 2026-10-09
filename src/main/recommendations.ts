// The recommended-parameters file (configs.json) — one of the two managed Draw
// Things dependencies. It has no version, but the server reports when it last
// changed (Last-Modified), and that time is its identity: Install/Refresh
// validates and atomically publishes the file, then records that time with the
// file's hash under the storage root (recommendations-times), and a check asks
// the server for its time alone (an HTTP HEAD) without fetching the bytes. A file
// no record describes, or one served without a valid Last-Modified, has no known
// server time; its own modification time is never taken for it. The generation
// path reads it via resolveRecommendedParams; everything else is dependency
// management.

import fs from 'fs'
import path from 'path'
import { writeFileAtomicAsync } from './utils/atomic-write'
import { resolveModelsDir } from './local-cli'
import { recordedServerTime, recordServerTime } from './dependencies/recommendations-times'
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

// configs.json lives in the effective models dir, alongside Draw Things' own
// custom.json — its natural home, and shared with the GUI app's models when the
// user points models_dir there.
export function getRecommendationsPath(): string {
  return path.join(resolveModelsDir(), RECOMMENDATIONS_FILE)
}

export async function getRecommendationsStatus(): Promise<RecommendationStatus> {
  const filePath = getRecommendationsPath()
  if (!await fs.promises.stat(filePath).then(() => true, () => false)) {
    return { exists: false, valid: false, entryCount: 0, updatedAt: null }
  }

  const parsed = await parseRecommendationFile(filePath)
  return {
    exists: true,
    valid: parsed.error === null,
    entryCount: parsed.specs.length,
    updatedAt: await recordedServerTime(filePath)
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
      const { body: data, headers } = await fetchBytesWithHeaders(
        RECOMMENDATIONS_URL,
        RECOMMENDATIONS_LIMITS,
        boundedSignal
      )
      validateRecommendationBytes(data)
      boundedSignal.throwIfAborted()

      await fs.promises.mkdir(resolveModelsDir(), { recursive: true })
      const filePath = getRecommendationsPath()
      // not recorded: configs.json is a re-fetchable managed dependency downloaded verbatim from
      // models.drawthings.ai, living in the effective models dir alongside Draw Things' own model data
      // (not under ~/.imagequeue/) — re-acquirable content the app reads, not durable user-authored text
      // (data-backup conventions: re-fetchable dependencies are not recorded).
      await writeFileAtomicAsync(filePath, data, false, boundedSignal)
      // The server's time is recorded for these bytes, so a later check can tell
      // whether the server has changed the file since. Without a valid header
      // the file's server time is unknown, and no record describes it.
      await recordServerTime(filePath, data, lastModifiedOf(headers))
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

export async function resolveRecommendedParams(model: string): Promise<RecommendedParams | null> {
  const parsed = await parseRecommendationFile(getRecommendationsPath())
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

async function parseRecommendationFile(filePath: string): Promise<{ specs: RecommendationSpec[]; error: string | null }> {
  try {
    const specs = parseRecommendationBytes(await fs.promises.readFile(filePath))
    return { specs, error: specs.length === 0 ? 'No recommendation entries found' : null }
  } catch (err) {
    return { specs: [], error: (err as Error).message }
  }
}
