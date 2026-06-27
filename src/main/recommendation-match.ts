import path from 'path'
import { RecommendedParams } from '../shared/types'

// The pure recommendation matching engine, separated from the file/network I/O
// shell in recommendations.ts so the exact -> prefix -> prefix-parent -> version
// cascade (and its quant-suffix stripping) can be tested directly against
// in-memory spec arrays, with no filesystem.

const QUANT_SUFFIXES = new Set(['f16', 'svd', 'q5p', 'q6p', 'q8p', 'i8x'])

export interface RecommendationSpec {
  name: string
  version?: string
  negative?: string
  configuration: Record<string, unknown>
}

export type RecommendationMatch = {
  spec: RecommendationSpec
  type: RecommendedParams['matchType']
}

export function isRecommendationSpec(value: unknown): value is RecommendationSpec {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.name === 'string' &&
    record.configuration !== null &&
    typeof record.configuration === 'object' &&
    !Array.isArray(record.configuration)
}

export function parseRecommendationBytes(data: Buffer): RecommendationSpec[] {
  const parsed = JSON.parse(data.toString('utf-8')) as unknown
  if (!Array.isArray(parsed)) return []
  return parsed.filter(isRecommendationSpec)
}

export function findRecommendedSettings(
  model: string,
  configurations: RecommendationSpec[]
): RecommendationMatch | null {
  const version = versionForModel(model)
  const modelPrefix = prefixFor(model)

  // 1. Exact configuration.model match.
  const exact = configurations.find((spec) => spec.configuration.model === model)
  if (exact) return { spec: exact, type: 'exact' }

  if (modelPrefix.length > 0) {
    // 2. Same model prefix (after quant-suffix stripping), different file.
    const prefix = configurations.find((spec) => {
      const configModel = spec.configuration.model
      return typeof configModel === 'string' && prefixFor(configModel) === modelPrefix
    })
    if (prefix) return { spec: prefix, type: 'prefix' }

    // 3. The model is a child of a config's prefix (e.g. flux_1_dev under flux_1).
    const parent = configurations.find((spec) => {
      const configModel = spec.configuration.model
      if (typeof configModel !== 'string') return false
      const configPrefix = prefixFor(configModel)
      return configPrefix.length > 0 && modelPrefix.startsWith(`${configPrefix}_`)
    })
    if (parent) return { spec: parent, type: 'prefix-parent' }
  }

  // 4. Same model family by version.
  if (version) {
    const versionMatch = configurations.find((spec) => spec.version === version)
    if (versionMatch) return { spec: versionMatch, type: 'version' }
  }

  return null
}

export function recommendedParamsFromMatch(match: RecommendationMatch): RecommendedParams {
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

export function prefixFor(file: string): string {
  const stem = path.basename(file, path.extname(file))
  if (!stem) return ''
  const components = stem.split('_')
  while (components.length > 0 && QUANT_SUFFIXES.has(components[components.length - 1])) {
    components.pop()
  }
  return components.join('_')
}

export function versionForModel(model: string): string | null {
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
