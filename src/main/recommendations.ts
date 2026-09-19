// The recommended-parameters file (configs.json) — one of the two managed Draw
// Things dependencies. It has no version, but the server reports when it last
// changed (Last-Modified), and that time is its identity: Install/Refresh
// validates and atomically publishes the file, then stamps it with that time,
// and a check asks the server for its time alone (an HTTP HEAD) without fetching
// the bytes. The generation path reads it via resolveRecommendedParams;
// everything else is dependency management.

import fs from 'fs'
import path from 'path'
import { writeFileAtomicAsync } from './utils/atomic-write'
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

// configs.json lives in the effective models dir, alongside Draw Things' own
// custom.json — its natural home, and shared with the GUI app's models when the
// user points models_dir there.
export function getRecommendationsPath(): string {
  return path.join(resolveModelsDir(), RECOMMENDATIONS_FILE)
}

export function getRecommendationsStatus(): RecommendationStatus {
  const filePath = getRecommendationsPath()
  if (!fs.existsSync(filePath)) {
    return { exists: false, valid: false, entryCount: 0, updatedAt: null }
  }

  const stat = fs.statSync(filePath)
  const parsed = parseRecommendationFile(filePath)
  return {
    exists: true,
    valid: parsed.error === null,
    entryCount: parsed.specs.length,
    updatedAt: stat.mtime.toISOString()
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

      ensureModelsDir()
      const filePath = getRecommendationsPath()
      // not recorded: configs.json is a re-fetchable managed dependency downloaded verbatim from
      // models.drawthings.ai, living in the effective models dir alongside Draw Things' own model data
      // (not under ~/.imagequeue/) — re-acquirable content the app reads, not durable user-authored text
      // (data-backup conventions: re-fetchable dependencies are not recorded).
      await writeFileAtomicAsync(filePath, data, false, boundedSignal)
      // The file carries the server's time as its own, so a later check can tell
      // whether the server has changed it since. Without that header it keeps
      // its write time, which is later than any change it was fetched after.
      const serverModified = lastModifiedOf(headers)
      if (serverModified) fs.utimesSync(filePath, new Date(), new Date(serverModified))
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
