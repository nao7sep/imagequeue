// Centralized model registry — single source of truth for models, sizes, parameters, and rough cost estimates.

import { BackendId, TextAIBackendId } from './types'

// --- Size presets ---

export interface SizePreset {
  label: string
  width: number
  height: number
}

// gpt-image-2 custom-size limits (OpenAI image-generation docs).
//
// The API's real lower bound is a MINIMUM TOTAL PIXEL COUNT, not a per-edge
// minimum — a small-area size like 1024x512 (524,288 px) is rejected by the API
// even though both edges are large. That area rule is OPENAI_GPT2_MIN_PIXELS,
// enforced at request time in validateGptImage2Size (openai-request.ts).
//
// OPENAI_GPT2_MIN_EDGE is a separate, softer concern: the per-edge floor the
// renderer clamps the width/height INPUT controls to, so a single dimension can't
// be normalized to something absurd. It is NOT the API constraint — a per-edge-valid
// pair can still be too small in area and is rejected by the min-pixels check.
export const OPENAI_GPT2_MIN_EDGE = 512
export const OPENAI_GPT2_MIN_PIXELS = 655_360
export const OPENAI_GPT2_MAX_EDGE = 3840
export const OPENAI_GPT2_SIZE_STEP = 16
export const OPENAI_GPT2_MAX_ASPECT_RATIO = 3
export const OPENAI_GPT2_MAX_PIXELS = 8_294_400

// Sizes for GPT Image 1.x models (exactly these three)
const OPENAI_SIZES: SizePreset[] = [
  { label: '1024×1024 (Square)', width: 1024, height: 1024 },
  { label: '1536×1024 (3:2)', width: 1536, height: 1024 },
  { label: '1024×1536 (2:3)', width: 1024, height: 1536 }
]

// The app's general-purpose size ladder, shared by every surface that offers free
// choice of dimensions rather than a model-dictated list: gpt-image-2's custom
// sizing, FLUX (filtered to its 4MP ceiling), and Draw Things. Shared deliberately
// — editing an entry moves all three, which is the intent; a backend needing its
// own ladder gets its own constant rather than a divergent copy of this one.
export const STANDARD_SIZE_PRESETS: SizePreset[] = [
  { label: '1024×1024 (Square)', width: 1024, height: 1024 },
  { label: '2048×2048 (Square Large)', width: 2048, height: 2048 },
  { label: '2048×1024 (2:1)', width: 2048, height: 1024 },
  { label: '2048×1152 (16:9)', width: 2048, height: 1152 },
  { label: '2048×1360 (3:2)', width: 2048, height: 1360 },
  { label: '2048×1456 (A4 Wide)', width: 2048, height: 1456 },
  { label: '2048×1536 (4:3)', width: 2048, height: 1536 },
  { label: '2048×1584 (Letter Wide)', width: 2048, height: 1584 },
  { label: '2560×1440 (QHD Wide)', width: 2560, height: 1440 },
  { label: '3840×2160 (4K Wide)', width: 3840, height: 2160 },
  { label: '1024×2048 (1:2)', width: 1024, height: 2048 },
  { label: '1152×2048 (9:16)', width: 1152, height: 2048 },
  { label: '1360×2048 (2:3)', width: 1360, height: 2048 },
  { label: '1456×2048 (A4 Tall)', width: 1456, height: 2048 },
  { label: '1536×2048 (3:4)', width: 1536, height: 2048 },
  { label: '1584×2048 (Letter Tall)', width: 1584, height: 2048 },
  { label: '1440×2560 (QHD Tall)', width: 1440, height: 2560 },
  { label: '2160×3840 (4K Tall)', width: 2160, height: 3840 }
]

// Google uses aspect ratios; sizes are "1K" (~1024px) or "2K" (~2048px, standard/ultra only)
export type ImagenAspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9'
export type ImagenImageSize = '1K' | '2K'

const IMAGEN_ASPECT_RATIOS: { label: string; value: ImagenAspectRatio }[] = [
  { label: '1:1', value: '1:1' },
  { label: '3:4', value: '3:4' },
  { label: '4:3', value: '4:3' },
  { label: '9:16', value: '9:16' },
  { label: '16:9', value: '16:9' }
]

const IMAGEN_IMAGE_SIZES: { label: string; value: ImagenImageSize }[] = [
  { label: '1K', value: '1K' },
  { label: '2K', value: '2K' }
]

// FLUX.2's dimension limits, named here beside the OpenAI equivalents above and
// exported for the FLUX backend to validate against — the ladder below and that
// check must agree, so they read the same constants.
export const FLUX_MAX_PIXELS = 4_194_304
export const FLUX_SIZE_STEP = 16

// FLUX.2 allows flexible sizes up to its ceiling: the standard ladder, minus what
// does not fit.
const FLUX_SIZES: SizePreset[] = STANDARD_SIZE_PRESETS.filter(
  ({ width, height }) => width * height <= FLUX_MAX_PIXELS
)

// --- Model definitions ---

export type OpenAIQuality = 'low' | 'medium' | 'high' | 'auto'
export type OpenAIModeration = 'low' | 'auto'
export type OpenAIOutputFormat = 'png' | 'jpeg' | 'webp'
export type OpenAIBackground = 'opaque' | 'transparent' | 'auto'
export type ImagenPersonGeneration = 'dont_allow' | 'allow_adult' | 'allow_all'

// Display names for the two option sets whose wire values do not survive a
// mechanical prettify ('webp' → 'WebP', 'dont_allow' → "Don't allow"). Each model
// declares which values it supports; these name them. Quality, moderation, and
// background are single lowercase words and are capitalized at the call site.
export const OPENAI_OUTPUT_FORMAT_LABELS: Record<OpenAIOutputFormat, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP'
}

export const IMAGEN_PERSON_GENERATION_LABELS: Record<ImagenPersonGeneration, string> = {
  dont_allow: "Don't allow",
  allow_adult: 'Allow adult',
  allow_all: 'Allow all'
}

export interface ModelDef {
  id: string
  label: string
  backend: BackendId
  isDefault?: boolean
}

export interface OpenAIModelDef extends ModelDef {
  backend: 'openai'
  qualities: OpenAIQuality[]
  moderations: OpenAIModeration[]
  sizes: SizePreset[]
  supportsCustomSizes?: boolean
  outputFormats: OpenAIOutputFormat[]
  backgrounds: OpenAIBackground[]
}

export interface ImagenModelDef extends ModelDef {
  backend: 'imagen'
  aspectRatios: typeof IMAGEN_ASPECT_RATIOS
  imageSizes: typeof IMAGEN_IMAGE_SIZES
  supportsImageSize: boolean
  personGeneration: ImagenPersonGeneration[]
}

export interface FluxModelDef extends ModelDef {
  backend: 'flux'
  sizes: SizePreset[]
  // Only FLUX.2 Flex exposes steps and guidance in the public API.
  stepsRange?: { min: number; max: number; default: number }
  guidanceRange?: { min: number; max: number; default: number }
}

// Nano Banana (Gemini native image generation) aspect ratios and sizes.
// Source: https://ai.google.dev/gemini-api/docs/image-generation
const NANO_BANANA_ASPECT_RATIOS_BASE: { label: string; value: string }[] = [
  { label: '1:1',  value: '1:1' },
  { label: '2:3',  value: '2:3' },
  { label: '3:2',  value: '3:2' },
  { label: '3:4',  value: '3:4' },
  { label: '4:3',  value: '4:3' },
  { label: '4:5',  value: '4:5' },
  { label: '5:4',  value: '5:4' },
  { label: '9:16', value: '9:16' },
  { label: '16:9', value: '16:9' },
  { label: '21:9', value: '21:9' }
]

// The Gemini 3.1 image generation (both gemini-3.1-flash-image and its Lite
// sibling) add the extra extreme ratios on top of the base set. Live-verified
// 2026-07-16: both accept 4:1 (and reject on the 3-pro / 2.5 models).
const NANO_BANANA_ASPECT_RATIOS_FLASH2: { label: string; value: string }[] = [
  { label: '1:1',  value: '1:1' },
  { label: '1:4',  value: '1:4' },
  { label: '1:8',  value: '1:8' },
  { label: '2:3',  value: '2:3' },
  { label: '3:2',  value: '3:2' },
  { label: '3:4',  value: '3:4' },
  { label: '4:1',  value: '4:1' },
  { label: '4:3',  value: '4:3' },
  { label: '4:5',  value: '4:5' },
  { label: '5:4',  value: '5:4' },
  { label: '8:1',  value: '8:1' },
  { label: '9:16', value: '9:16' },
  { label: '16:9', value: '16:9' },
  { label: '21:9', value: '21:9' }
]

const NANO_BANANA_SIZES_FLASH2: { label: string; value: string }[] = [
  { label: '0.5K', value: '512' },
  { label: '1K',   value: '1K' },
  { label: '2K',   value: '2K' },
  { label: '4K',   value: '4K' }
]

const NANO_BANANA_SIZES_PRO: { label: string; value: string }[] = [
  { label: '1K', value: '1K' },
  { label: '2K', value: '2K' },
  { label: '4K', value: '4K' }
]

const NANO_BANANA_SIZES: { label: string; value: string }[] = [
  { label: '1K', value: '1K' },
  { label: '2K', value: '2K' },
  { label: '4K', value: '4K' }
]

// Nano Banana 2 Lite (Gemini 3.1 Flash-Lite Image) generates at 1K only.
const NANO_BANANA_SIZES_LITE: { label: string; value: string }[] = [
  { label: '1K', value: '1K' }
]

export interface NanoBananaModelDef extends ModelDef {
  backend: 'nanobanana'
  // Image config support varies by model and is controlled per registry entry.
  supportsImageConfig: boolean
  aspectRatios: { label: string; value: string }[]
  imageSizes: { label: string; value: string }[]
}

export type GrokAspectRatio =
  'auto' | '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3' |
  '2:1' | '1:2' | '19.5:9' | '9:19.5' | '20:9' | '9:20'

const GROK_ASPECT_RATIOS: { label: string; value: GrokAspectRatio }[] = [
  // 'auto' lets Grok pick the ratio for the prompt (live-verified accepted).
  { label: 'Auto',   value: 'auto' },
  { label: '1:1',    value: '1:1' },
  { label: '1:2',    value: '1:2' },
  { label: '2:1',    value: '2:1' },
  { label: '2:3',    value: '2:3' },
  { label: '3:2',    value: '3:2' },
  { label: '3:4',    value: '3:4' },
  { label: '4:3',    value: '4:3' },
  { label: '9:16',   value: '9:16' },
  { label: '9:19.5', value: '9:19.5' },
  { label: '9:20',   value: '9:20' },
  { label: '16:9',   value: '16:9' },
  { label: '19.5:9', value: '19.5:9' },
  { label: '20:9',   value: '20:9' },
]

export type GrokResolution = '1k' | '2k'

const GROK_RESOLUTIONS: { label: string; value: GrokResolution }[] = [
  { label: '1K', value: '1k' },
  { label: '2K', value: '2k' }
]

export interface GrokModelDef extends ModelDef {
  backend: 'grok'
  aspectRatios: { label: string; value: GrokAspectRatio }[]
  resolutions: { label: string; value: GrokResolution }[]
}

// --- OpenAI models ---

export const OPENAI_MODELS: OpenAIModelDef[] = [
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    backend: 'openai',
    isDefault: true,
    qualities: ['auto', 'low', 'medium', 'high'],
    moderations: ['auto', 'low'],
    sizes: STANDARD_SIZE_PRESETS,
    supportsCustomSizes: true,
    outputFormats: ['png', 'jpeg', 'webp'],
    backgrounds: ['opaque', 'auto'],
  },
  {
    id: 'gpt-image-1.5',
    label: 'GPT Image 1.5',
    backend: 'openai',
    qualities: ['auto', 'low', 'medium', 'high'],
    moderations: ['auto', 'low'],
    sizes: OPENAI_SIZES,
    outputFormats: ['png', 'jpeg', 'webp'],
    backgrounds: ['opaque', 'transparent', 'auto'],
  },
  {
    id: 'gpt-image-1',
    label: 'GPT Image 1',
    backend: 'openai',
    qualities: ['auto', 'low', 'medium', 'high'],
    moderations: ['auto', 'low'],
    sizes: OPENAI_SIZES,
    outputFormats: ['png', 'jpeg', 'webp'],
    backgrounds: ['opaque', 'transparent', 'auto'],
  },
  {
    id: 'gpt-image-1-mini',
    label: 'GPT Image 1 Mini',
    backend: 'openai',
    qualities: ['auto', 'low', 'medium', 'high'],
    moderations: ['auto', 'low'],
    sizes: OPENAI_SIZES,
    outputFormats: ['png', 'jpeg', 'webp'],
    backgrounds: ['opaque', 'transparent', 'auto'],
  }
]

// --- Imagen models ---

export const IMAGEN_MODELS: ImagenModelDef[] = [
  {
    id: 'imagen-4.0-ultra-generate-001',
    label: 'Imagen 4 Ultra',
    backend: 'imagen',
    aspectRatios: IMAGEN_ASPECT_RATIOS,
    imageSizes: IMAGEN_IMAGE_SIZES,
    supportsImageSize: true,
    personGeneration: ['dont_allow', 'allow_adult', 'allow_all'],
  },
  {
    id: 'imagen-4.0-generate-001',
    label: 'Imagen 4',
    backend: 'imagen',
    isDefault: true,
    aspectRatios: IMAGEN_ASPECT_RATIOS,
    imageSizes: IMAGEN_IMAGE_SIZES,
    supportsImageSize: true,
    personGeneration: ['dont_allow', 'allow_adult', 'allow_all'],
  },
  {
    id: 'imagen-4.0-fast-generate-001',
    label: 'Imagen 4 Fast',
    backend: 'imagen',
    aspectRatios: IMAGEN_ASPECT_RATIOS,
    imageSizes: IMAGEN_IMAGE_SIZES,
    supportsImageSize: false,
    personGeneration: ['dont_allow', 'allow_adult', 'allow_all'],
  }
]

// --- FLUX models ---

export const FLUX_MODELS: FluxModelDef[] = [
  {
    id: 'flux-2-max',
    label: 'FLUX.2 Max',
    backend: 'flux',
    sizes: FLUX_SIZES,
  },
  {
    id: 'flux-2-pro',
    label: 'FLUX.2 Pro',
    backend: 'flux',
    isDefault: true,
    sizes: FLUX_SIZES,
  },
  {
    id: 'flux-2-flex',
    label: 'FLUX.2 Flex',
    backend: 'flux',
    sizes: FLUX_SIZES,
    // Source: https://api.bfl.ai/openapi.json — Flux2FlexInputs
    stepsRange: { min: 1, max: 50, default: 50 },
    guidanceRange: { min: 1.5, max: 10, default: 5 },
  },
  {
    id: 'flux-2-klein-9b',
    label: 'FLUX.2 Klein 9B',
    backend: 'flux',
    sizes: FLUX_SIZES,
  },
  {
    id: 'flux-2-klein-4b',
    label: 'FLUX.2 Klein 4B',
    backend: 'flux',
    sizes: FLUX_SIZES,
  }
]

// --- Nano Banana (Gemini native image generation) models ---

// Listed high -> middle -> low tier (pro -> flash -> flash-lite), the fleet
// ordering rule: capability tier drives the order, not recency, so a newer middle
// model still sorts below the high one. The two Gemini-3 image ids are the GA
// models; their `-preview` predecessors (gemini-3.1-flash-image-preview,
// gemini-3-pro-image-preview) were shut down 2026-06-25 and must not be shipped.
export const NANO_BANANA_MODELS: NanoBananaModelDef[] = [
  {
    id: 'gemini-3-pro-image',
    label: 'Nano Banana Pro',
    backend: 'nanobanana',
    supportsImageConfig: true,
    aspectRatios: NANO_BANANA_ASPECT_RATIOS_BASE,
    imageSizes: NANO_BANANA_SIZES_PRO,
  },
  {
    id: 'gemini-3.1-flash-image',
    label: 'Nano Banana 2',
    backend: 'nanobanana',
    isDefault: true,
    supportsImageConfig: true,
    aspectRatios: NANO_BANANA_ASPECT_RATIOS_FLASH2,
    imageSizes: NANO_BANANA_SIZES_FLASH2,
  },
  {
    id: 'gemini-2.5-flash-image',
    label: 'Nano Banana',
    backend: 'nanobanana',
    supportsImageConfig: true,
    aspectRatios: NANO_BANANA_ASPECT_RATIOS_BASE,
    imageSizes: NANO_BANANA_SIZES,
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    label: 'Nano Banana 2 Lite',
    backend: 'nanobanana',
    supportsImageConfig: true,
    // Same 3.1 generation as gemini-3.1-flash-image: it accepts the extreme ratios
    // too (live-verified), so it gets the extended list, not the base-10.
    aspectRatios: NANO_BANANA_ASPECT_RATIOS_FLASH2,
    imageSizes: NANO_BANANA_SIZES_LITE,
  }
]

// --- Grok Imagine models ---

export const GROK_MODELS: GrokModelDef[] = [
  {
    id: 'grok-imagine-image-quality',
    label: 'Grok Imagine Quality',
    backend: 'grok',
    aspectRatios: GROK_ASPECT_RATIOS,
    resolutions: GROK_RESOLUTIONS,
  },
  {
    id: 'grok-imagine-image',
    label: 'Grok Imagine',
    backend: 'grok',
    isDefault: true,
    aspectRatios: GROK_ASPECT_RATIOS,
    resolutions: GROK_RESOLUTIONS,
  }
]

// --- Text AI backends and models ---

// The Gemini text models imagequeue offers. A CLOSED list (ai-model-routing-conventions):
// the app ships it, the user picks the light and main tiers from it, nothing adds to it at
// runtime — so there is no list editor and no "Reset Gemini models". The two selections are
// stored; the list is not (it lives here, one home).
//
// Ordered by category (pro -> flash -> flash-lite), which also runs most- to least-expensive.
// Verified live 2026-07-16 for the text path: all four resolve and run both tiers (slug +
// elaboration) on dynamic thinking. Same four ids fotoready ships for vision — re-proven for
// text here rather than assumed to carry across modality. Verification is a design-time act;
// the app never queries the model-list endpoint. A wrong or retired selection surfaces at call
// time (the validity boundary), never from a stored list.
export const GEMINI_TEXT_MODELS = [
  'gemini-3.1-pro-preview',
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite'
] as const

export type GeminiTextModel = (typeof GEMINI_TEXT_MODELS)[number]

export interface TextAIBackendOption {
  id: TextAIBackendId
  label: string
}

export const TEXT_AI_BACKEND_OPTIONS: TextAIBackendOption[] = [
  { id: 'gemini', label: 'Gemini' },
  { id: 'openai', label: 'OpenAI' }
]

// --- Lookup helpers ---

export function getModelsForBackend(backend: 'openai'): OpenAIModelDef[]
export function getModelsForBackend(backend: 'imagen'): ImagenModelDef[]
export function getModelsForBackend(backend: 'nanobanana'): NanoBananaModelDef[]
export function getModelsForBackend(backend: 'grok'): GrokModelDef[]
export function getModelsForBackend(backend: 'flux'): FluxModelDef[]
// A non-literal backend (e.g. one that may be 'drawthings') gets the common
// ModelDef[]; 'drawthings' has no cloud model registry and returns [].
export function getModelsForBackend(backend: BackendId): ModelDef[]
export function getModelsForBackend(backend: BackendId): ModelDef[] {
  switch (backend) {
    case 'openai': return OPENAI_MODELS
    case 'imagen': return IMAGEN_MODELS
    case 'nanobanana': return NANO_BANANA_MODELS
    case 'grok': return GROK_MODELS
    case 'flux': return FLUX_MODELS
    default: return []
  }
}

// The model a backend starts on: the registry entry marked isDefault. This is the
// only place that answer is derived, so config seeding and the renderer's fallback
// cannot drift apart from the registry or from each other. A backend whose registry
// marks no default (or has no registry, like Draw Things) falls back to its first
// entry, and returns undefined only when it has no models at all.
export function getDefaultModelForBackend(backend: 'openai'): OpenAIModelDef
export function getDefaultModelForBackend(backend: 'imagen'): ImagenModelDef
export function getDefaultModelForBackend(backend: 'nanobanana'): NanoBananaModelDef
export function getDefaultModelForBackend(backend: 'grok'): GrokModelDef
export function getDefaultModelForBackend(backend: 'flux'): FluxModelDef
export function getDefaultModelForBackend(backend: BackendId): ModelDef | undefined
export function getDefaultModelForBackend(backend: BackendId): ModelDef | undefined {
  const models = getModelsForBackend(backend)
  return models.find((model) => model.isDefault) ?? models[0]
}

export function findModel(backend: 'openai', modelId: string): OpenAIModelDef | undefined
export function findModel(backend: 'imagen', modelId: string): ImagenModelDef | undefined
export function findModel(backend: 'nanobanana', modelId: string): NanoBananaModelDef | undefined
export function findModel(backend: 'grok', modelId: string): GrokModelDef | undefined
export function findModel(backend: 'flux', modelId: string): FluxModelDef | undefined
export function findModel(backend: BackendId, modelId: string): ModelDef | undefined {
  return getModelsForBackend(backend as 'openai').find((m) => m.id === modelId)
}

