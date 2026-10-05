import type { CloudBackendId, TextAIBackendId } from './types'
import {
  FLUX_SIZES,
  GROK_ASPECT_RATIOS,
  GROK_QUALITY_VALUES,
  GROK_RESOLUTIONS,
  GROK_RESOLUTIONS_2,
  NANO_BANANA_ASPECT_RATIOS_BASE,
  NANO_BANANA_ASPECT_RATIOS_FLASH2,
  NANO_BANANA_SIZES_FLASH2,
  NANO_BANANA_SIZES_LITE,
  NANO_BANANA_SIZES_PRO,
  STANDARD_SIZE_PRESETS,
  type FluxModelDef,
  type GrokModelDef,
  type ImageKind,
  type ImageProviderId,
  type ModelDef,
  type NanoBananaModelDef,
  type OpenAIModelDef,
} from './models'

export type TextKind = 'text-frontier' | 'text-smart' | 'text-balanced' | 'text-fast'
export type ModelKind = TextKind | ImageKind
export type ProviderId = TextAIBackendId | ImageProviderId

export interface TextModel {
  provider: TextAIBackendId
  id: string
  kinds: readonly TextKind[]
  defaultFor: readonly TextKind[]
  // The thinking values the model accepts, in the provider's own words: a
  // no-thinking value first, then lowest to highest.
  thinking: readonly string[]
  // The value a role sends until the user picks another, set by the model's own
  // tier, not by the role it serves.
  defaultThinking: string
}

export type ImageModel = OpenAIModelDef | NanoBananaModelDef | GrokModelDef | FluxModelDef
export type SupportedModel = TextModel | ImageModel

// The lineup research document these rows and defaults rest on.
export const MODEL_LINEUP = 'ai-model-lineup-20261004'

// Every row has its branch in a request builder: text in main/text-ai/request.ts,
// images in main/backends/*-request.ts. Within a provider and kind, rows run from
// the highest tier to the lowest, newest first within a tier.
export const SUPPORTED_MODELS: readonly SupportedModel[] = [
  { provider: 'gemini', id: 'gemini-3.1-pro-preview', kinds: ['text-smart'], defaultFor: ['text-smart'], thinking: ['low', 'medium', 'high'], defaultThinking: 'medium' },
  { provider: 'gemini', id: 'gemini-3.8-flash', kinds: ['text-balanced'], defaultFor: ['text-balanced'], thinking: ['low', 'medium', 'high'], defaultThinking: 'medium' },
  { provider: 'gemini', id: 'gemini-3.5-flash-lite', kinds: ['text-fast'], defaultFor: ['text-fast'], thinking: ['minimal', 'low', 'medium', 'high'], defaultThinking: 'minimal' },
  { provider: 'openai', id: 'gpt-6-astra', kinds: ['text-frontier'], defaultFor: [], thinking: ['low', 'medium', 'high', 'xhigh', 'max'], defaultThinking: 'medium' },
  { provider: 'openai', id: 'gpt-6.1-sol', kinds: ['text-smart'], defaultFor: ['text-smart'], thinking: ['low', 'medium', 'high', 'xhigh', 'max'], defaultThinking: 'medium' },
  { provider: 'openai', id: 'gpt-5.6-terra', kinds: ['text-balanced'], defaultFor: ['text-balanced'], thinking: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], defaultThinking: 'medium' },
  { provider: 'openai', id: 'gpt-6-luna', kinds: ['text-fast'], defaultFor: ['text-fast'], thinking: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], defaultThinking: 'none' },

  // OpenAI images. ImageQueue only generates, so the editing Sunburst is not listed.
  {
    provider: 'openai', id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare', backend: 'openai',
    kinds: ['image-generate'], defaultFor: ['image-generate'],
    qualities: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
    sizes: STANDARD_SIZE_PRESETS,
    outputFormats: ['png', 'jpeg', 'webp'],
    backgrounds: ['auto', 'transparent', 'opaque'],
  },
  {
    provider: 'openai', id: 'gpt-image-2', label: 'GPT Image 2', backend: 'openai',
    kinds: ['image-generate'], defaultFor: [],
    qualities: ['auto', 'low', 'medium', 'high'],
    sizes: STANDARD_SIZE_PRESETS,
    outputFormats: ['png', 'jpeg', 'webp'],
    backgrounds: ['auto', 'transparent', 'opaque'],
  },

  // Gemini images (Nano Banana). Flash and Lite refuse low and medium thinking.
  // Flash keeps Google's own minimal as its default: medium, the balanced
  // baseline, is not offered, and high would break the balanced idea.
  {
    provider: 'gemini', id: 'gemini-3-pro-image', label: 'Nano Banana Pro', backend: 'nanobanana',
    kinds: ['image-generate'], defaultFor: [],
    aspectRatios: NANO_BANANA_ASPECT_RATIOS_BASE,
    imageSizes: NANO_BANANA_SIZES_PRO,
    thinking: ['minimal', 'low', 'medium', 'high'], defaultThinking: 'medium',
  },
  {
    provider: 'gemini', id: 'gemini-3.1-flash-image', label: 'Nano Banana 2', backend: 'nanobanana',
    kinds: ['image-generate'], defaultFor: ['image-generate'],
    aspectRatios: NANO_BANANA_ASPECT_RATIOS_FLASH2,
    imageSizes: NANO_BANANA_SIZES_FLASH2,
    thinking: ['minimal', 'high'], defaultThinking: 'minimal',
  },
  {
    provider: 'gemini', id: 'gemini-3.1-flash-lite-image', label: 'Nano Banana 2 Lite', backend: 'nanobanana',
    kinds: ['image-generate'], defaultFor: [],
    aspectRatios: NANO_BANANA_ASPECT_RATIOS_FLASH2,
    imageSizes: NANO_BANANA_SIZES_LITE,
    thinking: ['minimal', 'high'], defaultThinking: 'minimal',
  },

  // xAI images (Grok Imagine). Only 2.0 declares qualities. grok-imagine-image
  // stays: it is still served and much cheaper.
  {
    provider: 'xai', id: 'grok-imagine-image-2.0', label: 'Grok Imagine 2.0', backend: 'grok',
    kinds: ['image-generate'], defaultFor: ['image-generate'],
    aspectRatios: GROK_ASPECT_RATIOS,
    resolutions: GROK_RESOLUTIONS_2,
    qualities: GROK_QUALITY_VALUES,
  },
  {
    provider: 'xai', id: 'grok-imagine-image', label: 'Grok Imagine', backend: 'grok',
    kinds: ['image-generate'], defaultFor: [],
    aspectRatios: GROK_ASPECT_RATIOS,
    resolutions: GROK_RESOLUTIONS,
  },

  // Black Forest Labs images (FLUX).
  { provider: 'bfl', id: 'flux-2-max', label: 'FLUX.2 Max', backend: 'flux', kinds: ['image-generate'], defaultFor: [], sizes: FLUX_SIZES },
  { provider: 'bfl', id: 'flux-2-pro', label: 'FLUX.2 Pro', backend: 'flux', kinds: ['image-generate'], defaultFor: ['image-generate'], sizes: FLUX_SIZES },
  {
    provider: 'bfl', id: 'flux-2-flex', label: 'FLUX.2 Flex', backend: 'flux',
    kinds: ['image-generate'], defaultFor: [],
    sizes: FLUX_SIZES,
    // Source: https://api.bfl.ai/openapi.json — Flux2FlexInputs
    stepsRange: { min: 1, max: 50, default: 50 },
    guidanceRange: { min: 1.5, max: 10, default: 5 },
  },
  { provider: 'bfl', id: 'flux-2-klein-9b', label: 'FLUX.2 Klein 9B', backend: 'flux', kinds: ['image-generate'], defaultFor: [], sizes: FLUX_SIZES },
  { provider: 'bfl', id: 'flux-2-klein-4b', label: 'FLUX.2 Klein 4B', backend: 'flux', kinds: ['image-generate'], defaultFor: [], sizes: FLUX_SIZES },
]

export const AI_ROLES = [
  // Expands and varies a prompt; long outputs need balanced text quality.
  { id: 'elaboration', kind: 'text-balanced' },
  // File names from a prompt; short outputs need fast text quality.
  { id: 'slug', kind: 'text-fast' },
] as const
export type TextRole = (typeof AI_ROLES)[number]['id']
export const TEXT_PROVIDERS = ['gemini', 'openai'] as const
export const PROVIDER_ENDPOINTS: Record<TextAIBackendId, string> = {
  gemini: 'https://generativelanguage.googleapis.com',
  openai: 'https://api.openai.com/v1',
}

// Each image column is one provider's image-generate role. The backend ids are
// the released config, session and file-name keys, so they stay as they are.
export const IMAGE_BACKEND_PROVIDERS: Record<CloudBackendId, ImageProviderId> = {
  openai: 'openai',
  nanobanana: 'gemini',
  grok: 'xai',
  flux: 'bfl',
}

export function modelsFor(provider: TextAIBackendId, kind: TextKind): TextModel[]
export function modelsFor(provider: ProviderId, kind: ImageKind): ImageModel[]
export function modelsFor(provider: ProviderId, kind: ModelKind): SupportedModel[]
export function modelsFor(provider: ProviderId, kind: ModelKind): SupportedModel[] {
  return SUPPORTED_MODELS.filter((row) => row.provider === provider && (row.kinds as readonly ModelKind[]).includes(kind))
}

export function defaultModelFor(provider: ProviderId, kind: ModelKind): string {
  const rows = modelsFor(provider, kind)
  const row = rows.find((model) => (model.defaultFor as readonly ModelKind[]).includes(kind)) ?? rows[0]
  if (!row) throw new Error(`No model for ${provider}/${kind}`)
  return row.id
}

export function isTextModel(row: SupportedModel): row is TextModel {
  return !('backend' in row)
}

export function isImageModel(row: SupportedModel): row is ImageModel {
  return 'backend' in row
}

export function textRowFor(provider: TextAIBackendId, id: string): TextModel | undefined {
  const key = id.trim().toLowerCase()
  return SUPPORTED_MODELS.filter(isTextModel).find((row) => row.provider === provider && row.id === key)
}

// The value a role sends: its chosen value when the row lists it, else the
// row's default.
export function thinkingFor(row: TextModel, chosen: string): string {
  return row.thinking.includes(chosen) ? chosen : row.defaultThinking
}

// A row with one thinking value offers no choice, so it shows no Thinking field.
export function hasThinkingChoice(row: TextModel | undefined): row is TextModel {
  return row !== undefined && row.thinking.length > 1
}

// --- An image column's rows ---

export function getModelsForBackend(backend: 'openai'): OpenAIModelDef[]
export function getModelsForBackend(backend: 'nanobanana'): NanoBananaModelDef[]
export function getModelsForBackend(backend: 'grok'): GrokModelDef[]
export function getModelsForBackend(backend: 'flux'): FluxModelDef[]
// Draw Things' models are the files installed on the machine, so it has no rows.
export function getModelsForBackend(backend: CloudBackendId | 'drawthings'): ModelDef[]
export function getModelsForBackend(backend: CloudBackendId | 'drawthings'): ModelDef[] {
  return backend === 'drawthings' ? [] : IMAGE_ROWS_BY_BACKEND[backend]
}

// Computed once, so a column's list keeps its identity from render to render.
const IMAGE_ROWS_BY_BACKEND: Record<CloudBackendId, ImageModel[]> = {
  openai: modelsFor('openai', 'image-generate'),
  nanobanana: modelsFor('gemini', 'image-generate'),
  grok: modelsFor('xai', 'image-generate'),
  flux: modelsFor('bfl', 'image-generate'),
}

// The model a column starts on: the provider's image-generate default.
export function getDefaultModelForBackend(backend: 'openai'): OpenAIModelDef
export function getDefaultModelForBackend(backend: 'nanobanana'): NanoBananaModelDef
export function getDefaultModelForBackend(backend: 'grok'): GrokModelDef
export function getDefaultModelForBackend(backend: 'flux'): FluxModelDef
export function getDefaultModelForBackend(backend: CloudBackendId | 'drawthings'): ModelDef | undefined
export function getDefaultModelForBackend(backend: CloudBackendId | 'drawthings'): ModelDef | undefined {
  if (backend === 'drawthings') return undefined
  const id = defaultModelFor(IMAGE_BACKEND_PROVIDERS[backend], 'image-generate')
  return getModelsForBackend(backend).find((row) => row.id === id)
}

// The row for a column's model id, or undefined when the id is not in the list.
export function findModel(backend: 'openai', modelId: string): OpenAIModelDef | undefined
export function findModel(backend: 'nanobanana', modelId: string): NanoBananaModelDef | undefined
export function findModel(backend: 'grok', modelId: string): GrokModelDef | undefined
export function findModel(backend: 'flux', modelId: string): FluxModelDef | undefined
export function findModel(backend: CloudBackendId | 'drawthings', modelId: string): ModelDef | undefined
export function findModel(backend: CloudBackendId | 'drawthings', modelId: string): ModelDef | undefined {
  return getModelsForBackend(backend).find((row) => row.id === modelId)
}
