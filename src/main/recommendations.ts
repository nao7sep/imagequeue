import fs from 'fs'
import path from 'path'
import os from 'os'
import https from 'https'
import { getDataDir, loadConfig } from './config'
import { log, serializeError } from './logger'
import {
  RecommendedParams,
  RecommendationOperationResult,
  RecommendationStatus
} from '../shared/types'

const RECOMMENDATIONS_URL = 'https://models.drawthings.ai/configs.json'
const DATA_DIR = 'data'
const RECOMMENDATIONS_FILE = 'configs.json'
const QUANT_SUFFIXES = new Set(['f16', 'svd', 'q5p', 'q6p', 'q8p', 'i8x'])

interface RecommendationSpec {
  name: string
  version?: string
  negative?: string
  configuration: Record<string, unknown>
}

type MatchPredicate = (spec: RecommendationSpec) => boolean

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

  const configuration = match.spec.configuration
  return {
    width: numberValue(configuration.width),
    height: numberValue(configuration.height),
    steps: numberValue(configuration.steps),
    guidance: numberValue(configuration.guidanceScale),
    negativePrompt: typeof match.spec.negative === 'string'
      ? match.spec.negative.trim()
      : null,
    matchName: match.spec.name,
    matchModel: typeof configuration.model === 'string' ? configuration.model : null,
    matchType: match.type
  }
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

  fs.writeFileSync(filePath, data)
  return {
    ...getRecommendationsStatus(),
    changed: true,
    message: changedMessage
  }
}

function fetchBytes(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 10000 }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        fetchBytes(response.headers.location).then(resolve, reject)
        return
      }
      if (!response.statusCode || response.statusCode < 200 || response.statusCode > 299) {
        response.resume()
        reject(new Error(`Download failed with HTTP ${response.statusCode ?? 'unknown'}`))
        return
      }

      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
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

function parseRecommendationBytes(data: Buffer): RecommendationSpec[] {
  const parsed = JSON.parse(data.toString('utf-8')) as unknown
  if (!Array.isArray(parsed)) return []
  return parsed.filter(isRecommendationSpec)
}

function isRecommendationSpec(value: unknown): value is RecommendationSpec {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.name === 'string' &&
    record.configuration !== null &&
    typeof record.configuration === 'object' &&
    !Array.isArray(record.configuration)
}

function findRecommendedSettings(
  model: string,
  configurations: RecommendationSpec[]
): { spec: RecommendationSpec; type: RecommendedParams['matchType'] } | null {
  const version = versionForModel(model)
  const modelPrefix = prefixFor(model)

  const exactOrPrefix = matchWithLoRAs(
    configurations,
    new Set<string>(),
    (spec) => spec.configuration.model === model,
    (spec) => {
      const configModel = spec.configuration.model
      return typeof configModel === 'string' &&
        modelPrefix.length > 0 &&
        prefixFor(configModel) === modelPrefix
    }
  )
  if (exactOrPrefix) {
    return {
      spec: exactOrPrefix,
      type: exactOrPrefix.configuration.model === model ? 'exact' : 'prefix'
    }
  }

  const parent = matchWithLoRAs(configurations, new Set<string>(), (spec) => {
    const configModel = spec.configuration.model
    if (typeof configModel !== 'string' || modelPrefix.length === 0) return false
    const configPrefix = prefixFor(configModel)
    return configPrefix.length > 0 && modelPrefix.startsWith(`${configPrefix}_`)
  })
  if (parent) return { spec: parent, type: 'prefix-parent' }

  if (version) {
    const versionMatch = matchWithLoRAs(configurations, new Set<string>(), (spec) => spec.version === version)
    if (versionMatch) return { spec: versionMatch, type: 'version' }
  }

  return null
}

function matchWithLoRAs(
  configurations: RecommendationSpec[],
  loras: Set<string>,
  first: MatchPredicate,
  second?: MatchPredicate
): RecommendationSpec | null {
  if (loras.size === 0) {
    return configurations.find(first) ?? (second ? configurations.find(second) : undefined) ?? null
  }

  const withMatchingLoRAs = (predicate: MatchPredicate): RecommendationSpec | undefined =>
    configurations.find((spec) => {
      if (!predicate(spec)) return false
      const configLoras = spec.configuration.loras
      if (!Array.isArray(configLoras)) return false
      const files = new Set(
        configLoras
          .map((entry) => entry && typeof entry === 'object' ? (entry as Record<string, unknown>).file : null)
          .filter((file): file is string => typeof file === 'string')
      )
      return [...loras].every((file) => files.has(file))
    })

  return withMatchingLoRAs(first) ??
    (second ? withMatchingLoRAs(second) : undefined) ??
    configurations.find(first) ??
    (second ? configurations.find(second) : undefined) ??
    null
}

function prefixFor(file: string): string {
  const stem = path.basename(file, path.extname(file))
  if (!stem) return ''
  const components = stem.split('_')
  while (components.length > 0 && QUANT_SUFFIXES.has(components[components.length - 1])) {
    components.pop()
  }
  return components.join('_')
}

function versionForModel(model: string): string | null {
  const prefix = prefixFor(model).toLowerCase()
  if (prefix.includes('flux_2_klein_4b')) return 'flux2_4b'
  if (prefix.includes('flux_2_klein_9b')) return 'flux2_9b'
  if (prefix.includes('flux_2')) return 'flux2'
  if (prefix.includes('flux_1') || prefix.includes('flux1')) return 'flux1'
  if (prefix.includes('qwen_image') || prefix.startsWith('qwen')) return 'qwen_image'
  if (prefix.includes('z_image') || prefix.startsWith('z_')) return 'z_image'
  if (prefix.includes('hidream')) return 'hidream_i1'
  if (prefix.includes('hunyuan')) return 'hunyuan_video'
  if (prefix.includes('wan_v2.1_14b') || prefix.includes('wan_2.1_14b')) return 'wan_v2.1_14b'
  if (prefix.includes('ltx_2') || prefix.includes('ltx2')) return 'ltx2'
  if (prefix.includes('sdxl')) return 'sdxl_base_v0.9'
  if (prefix.includes('ernie_image')) return 'ernie_image'
  if (prefix.includes('cosmos') || prefix.includes('anima')) return 'cosmos2.5_2b'
  if (prefix.startsWith('sd_') || prefix.startsWith('v1_')) return 'v1'
  return null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function expandHome(value: string): string {
  return value.replace(/^~(?=$|\/|\\)/, os.homedir())
}
