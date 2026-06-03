import type { CloudBackendId } from '../../../shared/types'
import {
  FLUX_SIZES,
  GROK_ASPECT_RATIOS,
  GROK_RESOLUTIONS,
  IMAGEN_ASPECT_RATIOS,
  OPENAI_GPT2_MAX_EDGE,
  OPENAI_GPT2_MIN_EDGE,
  OPENAI_GPT2_SIZE_STEP,
  type FluxModelDef,
  type GrokAspectRatio,
  type GrokResolution,
  type ImagenModelDef,
  type ImagenPersonGeneration,
  type ModelDef,
  type NanoBananaModelDef,
  type OpenAIBackground,
  type OpenAIModeration,
  type OpenAIModelDef,
  type OpenAIOutputFormat,
  type OpenAIQuality,
} from '../../../shared/models'

export interface SavedImageBackendDefaults {
  model: string
  params: Record<string, unknown>
  ui: Record<string, unknown>
}

export function serializeImageBackendDefaults(model: string, params: Record<string, unknown>): string {
  return JSON.stringify({ model, params })
}

export function normalizeOpenAiDimension(value: number): number {
  if (!Number.isFinite(value)) return OPENAI_GPT2_MIN_EDGE
  const rounded = Math.round(value / OPENAI_GPT2_SIZE_STEP) * OPENAI_GPT2_SIZE_STEP
  return Math.max(OPENAI_GPT2_MIN_EDGE, Math.min(OPENAI_GPT2_MAX_EDGE, rounded))
}

export function resolveOpenAiSize(modelDef: OpenAIModelDef, width: unknown, height: unknown): { width: number; height: number } {
  const fallback = modelDef.sizes[0] ?? { label: '1024×1024', width: 1024, height: 1024 }
  const matchingPreset = typeof width === 'number' && typeof height === 'number'
    ? modelDef.sizes.find((size) => size.width === width && size.height === height)
    : null

  if (!modelDef.supportsCustomSizes) {
    const next = matchingPreset ?? fallback
    return { width: next.width, height: next.height }
  }

  if (typeof width !== 'number' || typeof height !== 'number') {
    return { width: fallback.width, height: fallback.height }
  }

  return {
    width: normalizeOpenAiDimension(width),
    height: normalizeOpenAiDimension(height),
  }
}

function savedModelId(models: ModelDef[], defaultModel: ModelDef | undefined, backendSettings: Record<string, unknown>): string {
  return typeof backendSettings.model === 'string' && models.some((m) => m.id === backendSettings.model)
    ? backendSettings.model
    : (defaultModel?.id ?? '')
}

export function resolveSavedImageBackendDefaults(
  backend: CloudBackendId,
  backendSettings: Record<string, unknown> | null,
  models: ModelDef[],
  defaultModel: ModelDef | undefined
): SavedImageBackendDefaults | null {
  if (!backendSettings) return null

  const savedDefaultParams = (backendSettings.default_params as Record<string, unknown> | undefined) ?? {}
  const model = savedModelId(models, defaultModel, backendSettings)

  if (backend === 'openai') {
    const modelDef = (models.find((m) => m.id === model) ?? defaultModel) as OpenAIModelDef | undefined
    if (!modelDef) return null
    const size = resolveOpenAiSize(modelDef, savedDefaultParams.width, savedDefaultParams.height)
    const moderation = typeof savedDefaultParams.moderation === 'string' && modelDef.moderations.includes(savedDefaultParams.moderation as OpenAIModeration)
      ? savedDefaultParams.moderation as OpenAIModeration
      : (modelDef.moderations.find((value) => value === 'auto') ?? modelDef.moderations[0])
    const quality = typeof savedDefaultParams.quality === 'string' && modelDef.qualities.includes(savedDefaultParams.quality as OpenAIQuality)
      ? savedDefaultParams.quality as OpenAIQuality
      : (modelDef.qualities.find((value) => value === 'auto') ?? modelDef.qualities[0])
    const outputFormat = typeof savedDefaultParams.outputFormat === 'string' && modelDef.outputFormats.includes(savedDefaultParams.outputFormat as OpenAIOutputFormat)
      ? savedDefaultParams.outputFormat as OpenAIOutputFormat
      : (modelDef.outputFormats.find((value) => value === 'png') ?? modelDef.outputFormats[0])
    const background = typeof savedDefaultParams.background === 'string' && modelDef.backgrounds.includes(savedDefaultParams.background as OpenAIBackground)
      ? savedDefaultParams.background as OpenAIBackground
      : (modelDef.backgrounds.find((value) => value === 'opaque') ?? modelDef.backgrounds[0])
    const params = {
      width: size.width,
      height: size.height,
      moderation,
      quality,
      outputFormat,
      background,
    }
    return { model, params, ui: params }
  }

  if (backend === 'imagen') {
    const modelDef = (models.find((m) => m.id === model) ?? defaultModel) as ImagenModelDef | undefined
    if (!modelDef) return null
    const aspectRatio = typeof savedDefaultParams.aspectRatio === 'string' && IMAGEN_ASPECT_RATIOS.some((item) => item.value === savedDefaultParams.aspectRatio)
      ? savedDefaultParams.aspectRatio
      : '1:1'
    const imageSize = typeof savedDefaultParams.imageSize === 'string' && modelDef.imageSizes.some((item) => item.value === savedDefaultParams.imageSize)
      ? savedDefaultParams.imageSize
      : '1K'
    const personGeneration = typeof savedDefaultParams.personGeneration === 'string' && modelDef.personGeneration.includes(savedDefaultParams.personGeneration as ImagenPersonGeneration)
      ? savedDefaultParams.personGeneration as ImagenPersonGeneration
      : (modelDef.personGeneration.find((value) => value === 'allow_all') ?? modelDef.personGeneration[0])
    const params = { aspectRatio, imageSize, personGeneration }
    return { model, params, ui: params }
  }

  if (backend === 'nanobanana') {
    const modelDef = (models.find((m) => m.id === model) ?? defaultModel) as NanoBananaModelDef | undefined
    if (!modelDef) return null
    const aspectRatio = typeof savedDefaultParams.aspectRatio === 'string' && modelDef.aspectRatios.some((item) => item.value === savedDefaultParams.aspectRatio)
      ? savedDefaultParams.aspectRatio
      : (modelDef.aspectRatios[0]?.value ?? '1:1')
    const imageSize = typeof savedDefaultParams.imageSize === 'string' && modelDef.imageSizes.some((item) => item.value === savedDefaultParams.imageSize)
      ? savedDefaultParams.imageSize
      : (modelDef.imageSizes[0]?.value ?? '1K')
    const ui = { aspectRatio, imageSize }
    return { model, params: modelDef.supportsImageConfig ? ui : {}, ui }
  }

  if (backend === 'grok') {
    const aspectRatio = typeof savedDefaultParams.aspectRatio === 'string' && GROK_ASPECT_RATIOS.some((item) => item.value === savedDefaultParams.aspectRatio)
      ? savedDefaultParams.aspectRatio as GrokAspectRatio
      : '1:1'
    const resolution = typeof savedDefaultParams.resolution === 'string' && GROK_RESOLUTIONS.some((item) => item.value === savedDefaultParams.resolution)
      ? savedDefaultParams.resolution as GrokResolution
      : '1k'
    const params = { aspectRatio, resolution }
    return { model, params, ui: params }
  }

  const modelDef = (models.find((m) => m.id === model) ?? defaultModel) as FluxModelDef | undefined
  if (!modelDef) return null
  const sizeIdx = FLUX_SIZES.findIndex(
    (size) => size.width === savedDefaultParams.width && size.height === savedDefaultParams.height
  )
  const size = FLUX_SIZES[sizeIdx >= 0 ? sizeIdx : 0]
  const steps = modelDef.stepsRange && typeof savedDefaultParams.steps === 'number'
    ? Math.max(modelDef.stepsRange.min, Math.min(modelDef.stepsRange.max, savedDefaultParams.steps))
    : (modelDef.stepsRange?.default ?? 50)
  const guidance = modelDef.guidanceRange && typeof savedDefaultParams.guidance === 'number'
    ? Math.max(modelDef.guidanceRange.min, Math.min(modelDef.guidanceRange.max, savedDefaultParams.guidance))
    : (modelDef.guidanceRange?.default ?? 5)
  const seed = savedDefaultParams.seed == null ? '' : String(savedDefaultParams.seed)
  const params: Record<string, unknown> = { width: size.width, height: size.height, seed: seed ? Number.parseInt(seed, 10) : null }
  if (modelDef.stepsRange) params.steps = steps
  if (modelDef.guidanceRange) params.guidance = guidance
  return {
    model,
    params,
    ui: {
      sizeIdx: sizeIdx >= 0 ? sizeIdx : 0,
      steps,
      guidance,
      seed,
    },
  }
}
