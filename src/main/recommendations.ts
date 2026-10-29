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
import { log, serializeError } from './logger'
import { recordedServerTime, recordServerTime } from './dependencies/recommendations-times'
import type { IncomingHttpHeaders } from 'http'
import {
  fetchBytesWithHeaders,
  fetchHeaders,
  RECOMMENDATIONS_LIMITS,
  RELEASE_METADATA_LIMITS,
} from './dependencies/download'
import {
  RecommendedParams,
  RecommendationStatus,
  RecommendationsInstallWarning,
} from '../shared/types'
import {
  RecommendationSpec,
  findRecommendedSettings,
  parseRecommendationBytes,
  recommendedParamsFromMatch
} from './recommendation-match'

const RECOMMENDATIONS_URL = 'https://models.drawthings.ai/configs.json'
const RECOMMENDATIONS_FILE = 'configs.json'

export interface InstalledRecommendations {
  filePath: string
  status: RecommendationStatus
  warnings: RecommendationsInstallWarning[]
}

// configs.json lives in the effective models dir, alongside Draw Things' own
// custom.json — its natural home, and shared with the GUI app's models when the
// user points models_dir there.
export function getRecommendationsPath(): string {
  return path.join(resolveModelsDir(), RECOMMENDATIONS_FILE)
}

export async function recommendationsExist(): Promise<boolean> {
  return fs.promises.stat(getRecommendationsPath()).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return false
    throw error
  })
}

export async function getRecommendationsStatus(): Promise<RecommendationStatus> {
  const filePath = getRecommendationsPath()
  const parsed = await parseRecommendationFile(filePath)
  return {
    exists: parsed.exists,
    valid: parsed.exists && parsed.error === null,
    entryCount: parsed.specs.length,
    updatedAt: parsed.bytes ? await recordedServerTime(filePath, parsed.bytes) : null
  }
}

/** Explicitly install or refresh configs.json. The download holds its own idle
 * and whole bounds; the install is cancellable through durable staging and
 * never runs from launch or Check. */
export async function downloadLatestRecommendations(signal?: AbortSignal): Promise<InstalledRecommendations> {
  const filePath = getRecommendationsPath()
  const { body: data, headers } = await fetchBytesWithHeaders(
    RECOMMENDATIONS_URL,
    RECOMMENDATIONS_LIMITS,
    signal
  )
  const specs = parseRecommendationBytes(data)
  if (specs.length === 0) throw new Error('Recommendation file is not valid configs.json')
  signal?.throwIfAborted()

  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  // not recorded: configs.json is a re-fetchable managed dependency downloaded verbatim from
  // models.drawthings.ai, living in the effective models dir alongside Draw Things' own model data
  // (not under ~/.imagequeue/) — re-acquirable content the app reads, not durable user-authored text
  // (data-backup conventions: re-fetchable dependencies are not recorded).
  await writeFileAtomicAsync(filePath, data, false, signal)
  // The server's time is recorded for these bytes, so a later check can tell
  // whether the server has changed the file since. Without a valid header
  // the file's server time is unknown, and no record describes it.
  const updatedAt = lastModifiedOf(headers)
  const warnings: RecommendationsInstallWarning[] = []
  try {
    await recordServerTime(filePath, data, updatedAt)
  } catch (error) {
    warnings.push('time-not-saved')
    log('warn', 'Recommended parameters were installed but their server time was not saved', { filePath, error: serializeError(error) })
  }
  return { filePath, status: { exists: true, valid: true, entryCount: specs.length, updatedAt }, warnings }
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
  return (await resolveRecommendedParamsForModels([model])).get(model) ?? null
}

/** Resolve a batch from one file snapshot, rather than rereading it per model. */
export async function resolveRecommendedParamsForModels(models: string[]): Promise<Map<string, RecommendedParams | null>> {
  if (models.length === 0) return new Map()
  const parsed = await parseRecommendationFile(getRecommendationsPath())
  if (parsed.error !== null) throw parsed.error
  return new Map(models.map((model) => {
    const match = findRecommendedSettings(model, parsed.specs)
    return [model, match ? recommendedParamsFromMatch(match) : null]
  }))
}

async function parseRecommendationFile(filePath: string): Promise<{
  exists: boolean; bytes: Buffer | null; specs: RecommendationSpec[]; error: Error | null
}> {
  let bytes: Buffer | null = null
  try {
    bytes = await fs.promises.readFile(filePath)
    const specs = parseRecommendationBytes(bytes)
    return { exists: true, bytes, specs, error: specs.length === 0 ? new Error('No recommendation entries found') : null }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false, bytes: null, specs: [], error: null }
    return { exists: true, bytes, specs: [], error: err instanceof Error ? err : new Error('Unable to read recommendations', { cause: err }) }
  }
}
