import fs from 'fs'
import path from 'path'
import os from 'os'
import https from 'https'
import { getDataDir, loadConfig } from './config'
import { log, serializeError } from './logger'
import { writeFileAtomic } from './utils/atomic-write'
import {
  RecommendedParams,
  RecommendationOperationResult,
  RecommendationStatus
} from '../shared/types'
import {
  RecommendationSpec,
  findRecommendedSettings,
  parseRecommendationBytes,
  recommendedParamsFromMatch
} from './recommendation-match'

const RECOMMENDATIONS_URL = 'https://models.drawthings.ai/configs.json'
const DATA_DIR = 'data'
const RECOMMENDATIONS_FILE = 'configs.json'

export function getRecommendationsDir(): string {
  return path.join(getDataDir(), DATA_DIR)
}

export function getRecommendationsPath(): string {
  return path.join(getRecommendationsDir(), RECOMMENDATIONS_FILE)
}

export function getRecommendationsStatus(): RecommendationStatus {
  const filePath = getRecommendationsPath()
  const directory = path.dirname(filePath)
  if (!fs.existsSync(filePath)) {
    return {
      path: filePath,
      directory,
      exists: false,
      valid: false,
      entryCount: 0,
      fileSize: null,
      updatedAt: null,
      error: null
    }
  }

  const stat = fs.statSync(filePath)
  const parsed = parseRecommendationFile(filePath)
  return {
    path: filePath,
    directory,
    exists: true,
    valid: parsed.error === null,
    entryCount: parsed.specs.length,
    fileSize: stat.size,
    updatedAt: stat.mtime.toISOString(),
    error: parsed.error
  }
}

export async function downloadLatestRecommendations(): Promise<RecommendationOperationResult> {
  const data = await fetchBytes(RECOMMENDATIONS_URL)
  return writeRecommendationsIfChanged(data, 'Downloaded latest recommendations', 'Recommendations already up to date')
}

export function importRecommendations(sourcePath: string): RecommendationOperationResult {
  const data = fs.readFileSync(sourcePath)
  return writeRecommendationsIfChanged(data, 'Imported recommendations', 'Imported file matches current recommendations')
}

export async function updateRecommendationsAtLaunch(): Promise<void> {
  try {
    const config = loadConfig()
    if (!config.image_backends.drawthings.auto_update_recommendations) {
      log('info', 'Recommendations launch update skipped', { reason: 'disabled' })
      return
    }
    log('info', 'Recommendations launch update started', { url: RECOMMENDATIONS_URL })
    const result = await downloadLatestRecommendations()
    log('info', 'Recommendations launch update finished', {
      changed: result.changed,
      detail: result.message,
      entryCount: result.entryCount,
      updatedAt: result.updatedAt
    })
  } catch (err) {
    log('warn', 'Recommendations launch update failed', {
      error: serializeError(err)
    })
  }
}

export function resolveRecommendedParams(model: string): RecommendedParams | null {
  const parsed = parseRecommendationFile(getRecommendationsPath())
  if (parsed.error !== null || parsed.specs.length === 0) return null
  const match = findRecommendedSettings(model, parsed.specs)
  if (!match) return null
  return recommendedParamsFromMatch(match)
}

function writeRecommendationsIfChanged(
  data: Buffer,
  changedMessage: string,
  unchangedMessage: string
): RecommendationOperationResult {
  const specs = parseRecommendationBytes(data)
  if (specs.length === 0) {
    throw new Error('Recommendation file is not valid configs.json')
  }

  const filePath = getRecommendationsPath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })

  if (fs.existsSync(filePath)) {
    const current = fs.readFileSync(filePath)
    if (current.equals(data)) {
      return {
        ...getRecommendationsStatus(),
        changed: false,
        message: unchangedMessage
      }
    }
  }

  writeFileAtomic(filePath, data)
  return {
    ...getRecommendationsStatus(),
    changed: true,
    message: changedMessage
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

export function expandHome(value: string): string {
  return value.replace(/^~(?=$|\/|\\)/, os.homedir())
}
