// The recommended-parameters file (configs.json) — one of the two managed Draw
// Things dependencies. It is app-owned and user-triggered: never fetched
// silently. Lifecycle here follows the managed-runtime-dependencies convention:
//
//   download  acquire when absent (or force a refresh) — writes configs.json.
//   check     fetch the latest to compare; if it differs, stage it as a pending
//             update and record that — check-not-apply, so nothing changes on disk.
//   apply     promote the staged pending update to configs.json.
//
// The file is versionless, so "update available" means a fetched copy differed
// byte-for-byte from the installed one. The generation path reads it via
// resolveRecommendedParams; everything else is dependency management.

import fs from 'fs'
import path from 'path'
import https from 'https'
import { writeFileAtomic } from './utils/atomic-write'
import { resolveModelsDir, ensureModelsDir } from './local-cli'
import { updateDependenciesCache } from './dependencies/store'
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
const RECOMMENDATIONS_PENDING_FILE = 'configs-pending.json'

// configs.json lives in the effective models dir, alongside Draw Things' own
// custom.json — its natural home, and shared with the GUI app's models when the
// user points models_dir there.
export function getRecommendationsPath(): string {
  return path.join(resolveModelsDir(), RECOMMENDATIONS_FILE)
}

function getRecommendationsPendingPath(): string {
  return path.join(resolveModelsDir(), RECOMMENDATIONS_PENDING_FILE)
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

/** Acquire (or force-refresh) configs.json from the server. Writes it directly,
 * which makes any staged pending update moot, so it is cleared. */
export async function downloadLatestRecommendations(): Promise<RecommendationStatus> {
  const data = await fetchBytes(RECOMMENDATIONS_URL)
  validateRecommendationBytes(data)

  ensureModelsDir()
  const filePath = getRecommendationsPath()
  const changed = !(fs.existsSync(filePath) && fs.readFileSync(filePath).equals(data))
  // not recorded: configs.json is a re-fetchable managed dependency downloaded verbatim from
  // models.drawthings.ai, living in the effective models dir alongside Draw Things' own model data
  // (not under ~/.imagequeue/) — re-acquirable content the app reads, not durable user-authored text
  // (data-backup conventions: re-fetchable dependencies are not recorded).
  if (changed) writeFileAtomic(filePath, data, false)
  clearPendingUpdate()
  updateDependenciesCache((cache) => {
    cache.recommendations.lastCheckedAtUtc = new Date().toISOString()
    cache.recommendations.pending = false
  })

  return getRecommendationsStatus()
}

/** Fetch the latest and compare to the installed file without changing it. If it
 * differs, stage it as a pending update and record that a check found one. Does
 * nothing destructive when configs.json is absent (that is the download path). */
export async function checkRecommendations(): Promise<RecommendationStatus> {
  const filePath = getRecommendationsPath()
  const checkedAt = new Date().toISOString()

  if (!fs.existsSync(filePath)) {
    clearPendingUpdate()
    updateDependenciesCache((cache) => {
      cache.recommendations.lastCheckedAtUtc = checkedAt
      cache.recommendations.pending = false
    })
    return getRecommendationsStatus()
  }

  const latest = await fetchBytes(RECOMMENDATIONS_URL)
  validateRecommendationBytes(latest)
  const differs = !fs.readFileSync(filePath).equals(latest)

  if (differs) {
    ensureModelsDir()
    // not recorded: configs-pending.json is a transient staging copy of a re-fetchable dependency
    // (a freshly fetched configs.json held for apply), in the models dir — re-acquirable, and cleared
    // once applied or superseded (data-backup conventions: re-fetchable/transient is not recorded).
    writeFileAtomic(getRecommendationsPendingPath(), latest, false)
  } else {
    clearPendingUpdate()
  }
  updateDependenciesCache((cache) => {
    cache.recommendations.lastCheckedAtUtc = checkedAt
    cache.recommendations.pending = differs
  })
  return getRecommendationsStatus()
}

/** Promote a staged pending update to configs.json. A no-op (returns current
 * status) when nothing is pending. */
export function applyPendingRecommendations(): RecommendationStatus {
  const pendingPath = getRecommendationsPendingPath()
  if (fs.existsSync(pendingPath)) {
    // not recorded: this promotes the already-written pending copy of a re-fetchable dependency
    // (configs.json, in the models dir) into place by rename — it produces no new managed-text bytes,
    // and configs.json is not recorded either way (see downloadLatestRecommendations).
    fs.renameSync(pendingPath, getRecommendationsPath())
  }
  updateDependenciesCache((cache) => {
    cache.recommendations.pending = false
  })
  return getRecommendationsStatus()
}

export function resolveRecommendedParams(model: string): RecommendedParams | null {
  const parsed = parseRecommendationFile(getRecommendationsPath())
  if (parsed.error !== null || parsed.specs.length === 0) return null
  const match = findRecommendedSettings(model, parsed.specs)
  if (!match) return null
  return recommendedParamsFromMatch(match)
}

function clearPendingUpdate(): void {
  try {
    fs.rmSync(getRecommendationsPendingPath(), { force: true })
  } catch {
    /* pending file lives under the rebuildable data dir */
  }
}

function validateRecommendationBytes(data: Buffer): void {
  if (parseRecommendationBytes(data).length === 0) {
    throw new Error('Recommendation file is not valid configs.json')
  }
}

const MAX_REDIRECTS = 5
const MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024 // configs.json is small; bound memory regardless

function fetchBytes(url: string, redirectsLeft = MAX_REDIRECTS): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      reject(new Error(`Invalid download URL: ${url}`))
      return
    }
    // Require https on the initial request and on every redirect hop, so a
    // redirect can't downgrade to http or bounce to a non-web scheme.
    if (parsed.protocol !== 'https:') {
      reject(new Error(`Refusing non-https download URL: ${parsed.protocol}`))
      return
    }

    const request = https.get(url, { timeout: 10000 }, (response) => {
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        if (redirectsLeft <= 0) {
          reject(new Error('Download failed: too many redirects'))
          return
        }
        const next = new URL(response.headers.location, url).toString()
        fetchBytes(next, redirectsLeft - 1).then(resolve, reject)
        return
      }
      if (status < 200 || status > 299) {
        response.resume()
        reject(new Error(`Download failed with HTTP ${response.statusCode ?? 'unknown'}`))
        return
      }

      const chunks: Buffer[] = []
      let total = 0
      response.on('data', (chunk: Buffer) => {
        total += chunk.length
        if (total > MAX_DOWNLOAD_BYTES) {
          request.destroy(new Error('Download exceeded maximum size'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => resolve(Buffer.concat(chunks)))
    })
    request.on('timeout', () => {
      request.destroy(new Error('Download timed out'))
    })
    request.on('error', reject)
  })
}

function parseRecommendationFile(filePath: string): { specs: RecommendationSpec[]; error: string | null } {
  try {
    const specs = parseRecommendationBytes(fs.readFileSync(filePath))
    return { specs, error: specs.length === 0 ? 'No recommendation entries found' : null }
  } catch (err) {
    return { specs: [], error: (err as Error).message }
  }
}
