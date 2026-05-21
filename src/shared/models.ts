// Centralized model registry — single source of truth for models, sizes, parameters, and pricing.

import { BackendId } from './types'

// --- Size presets ---

export interface SizePreset {
  label: string
  width: number
  height: number
}

export const OPENAI_GPT2_MIN_EDGE = 512
export const OPENAI_GPT2_MAX_EDGE = 3840
export const OPENAI_GPT2_SIZE_STEP = 16
export const OPENAI_GPT2_MAX_ASPECT_RATIO = 3
export const OPENAI_GPT2_MAX_PIXELS = 8_294_400

// Sizes for GPT Image 1.x models (exactly these three)
export const OPENAI_SIZES: SizePreset[] = [
  { label: '1024×1024 (Square)', width: 1024, height: 1024 },
  { label: '1536×1024 (3:2)', width: 1536, height: 1024 },
  { label: '1024×1536 (2:3)', width: 1024, height: 1536 }
]

// Useful presets for gpt-image-2 custom sizing.
export const OPENAI_SIZES_GPT2: SizePreset[] = [
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

export const IMAGEN_ASPECT_RATIOS: { label: string; value: ImagenAspectRatio }[] = [
  { label: '1:1', value: '1:1' },
  { label: '3:4', value: '3:4' },
  { label: '4:3', value: '4:3' },
  { label: '9:16', value: '9:16' },
  { label: '16:9', value: '16:9' }
]

export const IMAGEN_IMAGE_SIZES: { label: string; value: ImagenImageSize }[] = [
  { label: '1K', value: '1K' },
  { label: '2K', value: '2K' }
]

// FLUX.2 allows flexible sizes up to 4MP. Reuse the GPT-style preset ordering and
// labels, but keep only the entries that fit within FLUX's 4MP limit.
export const FLUX_SIZES: SizePreset[] = OPENAI_SIZES_GPT2.filter(
  ({ width, height }) => width * height <= 4_194_304
)

// --- Model definitions ---

export type OpenAIQuality = 'low' | 'medium' | 'high' | 'auto'
export type OpenAIModeration = 'low' | 'auto'
export type OpenAIOutputFormat = 'png' | 'jpeg' | 'webp'
export type OpenAIBackground = 'opaque' | 'transparent' | 'auto'
export type ImagenPersonGeneration = 'dont_allow' | 'allow_adult' | 'allow_all'

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
  pricing: Record<'low' | 'medium' | 'high', { square: number; rect: number }>
}

export interface ImagenModelDef extends ModelDef {
  backend: 'imagen'
  aspectRatios: typeof IMAGEN_ASPECT_RATIOS
  imageSizes: typeof IMAGEN_IMAGE_SIZES
  supportsImageSize: boolean
  personGeneration: ImagenPersonGeneration[]
  pricing: number
}

export interface FluxModelDef extends ModelDef {
  backend: 'flux'
  sizes: SizePreset[]
  // Only FLUX.2 Flex exposes steps and guidance in the public API.
  stepsRange?: { min: number; max: number; default: number }
  guidanceRange?: { min: number; max: number; default: number }
  pricing: { firstMp: number; additionalMp: number }
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

// Nano Banana 2 adds the extra extreme ratios documented for Gemini 3.1 Flash Image.
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

export interface NanoBananaModelDef extends ModelDef {
  backend: 'nanobanana'
  // Image config support varies by model and is controlled per registry entry.
  supportsImageConfig: boolean
  aspectRatios: { label: string; value: string }[]
  imageSizes: { label: string; value: string }[]
  // Pricing by imageSize value (e.g. '1K', '2K'). Flat-price models may repeat the
  // same value across all supported sizes.
  pricing: Record<string, number>
}

export type GrokAspectRatio =
  '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3' |
  '2:1' | '1:2' | '19.5:9' | '9:19.5' | '20:9' | '9:20'

export const GROK_ASPECT_RATIOS: { label: string; value: GrokAspectRatio }[] = [
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

export const GROK_RESOLUTIONS: { label: string; value: GrokResolution }[] = [
  { label: '1K', value: '1k' },
  { label: '2K', value: '2k' }
]

export interface GrokModelDef extends ModelDef {
  backend: 'grok'
  pricing: number  // per image, flat rate
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
    sizes: OPENAI_SIZES_GPT2,
    supportsCustomSizes: true,
    outputFormats: ['png', 'jpeg', 'webp'],
    backgrounds: ['opaque', 'auto'],
    pricing: {
      low: { square: 0.006, rect: 0.005 },
      medium: { square: 0.053, rect: 0.041 },
      high: { square: 0.211, rect: 0.165 }
    }
  },
  {
    id: 'gpt-image-1.5',
    label: 'GPT Image 1.5',
    backend: 'openai',
    qualities: ['auto', 'low', 'medium', 'high'],
    moderations: ['auto', 'low'],
    sizes: OPENAI_SIZES,
    outputFormats: ['png', 'jpeg', 'webp'],
    backgrounds: ['opaque', 'transparent'],
    pricing: {
      low: { square: 0.009, rect: 0.013 },
      medium: { square: 0.034, rect: 0.05 },
      high: { square: 0.133, rect: 0.20 }
    }
  },
  {
    id: 'gpt-image-1',
    label: 'GPT Image 1',
    backend: 'openai',
    qualities: ['auto', 'low', 'medium', 'high'],
    moderations: ['auto', 'low'],
    sizes: OPENAI_SIZES,
    outputFormats: ['png', 'jpeg', 'webp'],
    backgrounds: ['opaque', 'transparent'],
    pricing: {
      low: { square: 0.011, rect: 0.016 },
      medium: { square: 0.042, rect: 0.063 },
      high: { square: 0.167, rect: 0.25 }
    }
  },
  {
    id: 'gpt-image-1-mini',
    label: 'GPT Image 1 Mini',
    backend: 'openai',
    qualities: ['auto', 'low', 'medium', 'high'],
    moderations: ['auto', 'low'],
    sizes: OPENAI_SIZES,
    outputFormats: ['png', 'jpeg', 'webp'],
    backgrounds: ['opaque', 'transparent'],
    pricing: {
      low: { square: 0.005, rect: 0.006 },
      medium: { square: 0.011, rect: 0.015 },
      high: { square: 0.036, rect: 0.052 }
    }
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
    pricing: 0.06
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
    pricing: 0.04
  },
  {
    id: 'imagen-4.0-fast-generate-001',
    label: 'Imagen 4 Fast',
    backend: 'imagen',
    aspectRatios: IMAGEN_ASPECT_RATIOS,
    imageSizes: IMAGEN_IMAGE_SIZES,
    supportsImageSize: false,
    personGeneration: ['dont_allow', 'allow_adult', 'allow_all'],
    pricing: 0.02
  }
]

// --- FLUX models ---

export const FLUX_MODELS: FluxModelDef[] = [
  {
    id: 'flux-2-max',
    label: 'FLUX.2 Max',
    backend: 'flux',
    sizes: FLUX_SIZES,
    pricing: { firstMp: 0.07, additionalMp: 0.03 }
  },
  {
    id: 'flux-2-pro',
    label: 'FLUX.2 Pro',
    backend: 'flux',
    isDefault: true,
    sizes: FLUX_SIZES,
    pricing: { firstMp: 0.03, additionalMp: 0.015 }
  },
  {
    id: 'flux-2-flex',
    label: 'FLUX.2 Flex',
    backend: 'flux',
    sizes: FLUX_SIZES,
    // Source: https://api.bfl.ai/openapi.json — Flux2FlexInputs
    stepsRange: { min: 1, max: 50, default: 50 },
    guidanceRange: { min: 1.5, max: 10, default: 5 },
    pricing: { firstMp: 0.06, additionalMp: 0 }
  },
  {
    id: 'flux-2-klein-9b',
    label: 'FLUX.2 Klein 9B',
    backend: 'flux',
    sizes: FLUX_SIZES,
    pricing: { firstMp: 0.015, additionalMp: 0.002 }
  },
  {
    id: 'flux-2-klein-4b',
    label: 'FLUX.2 Klein 4B',
    backend: 'flux',
    sizes: FLUX_SIZES,
    pricing: { firstMp: 0.014, additionalMp: 0.001 }
  }
]

// --- Nano Banana (Gemini native image generation) models ---

export const NANO_BANANA_MODELS: NanoBananaModelDef[] = [
  {
    id: 'gemini-3.1-flash-image-preview',
    label: 'Nano Banana 2',
    backend: 'nanobanana',
    isDefault: true,
    supportsImageConfig: true,
    aspectRatios: NANO_BANANA_ASPECT_RATIOS_FLASH2,
    imageSizes: NANO_BANANA_SIZES_FLASH2,
    // Per-image pricing from documented token counts × $60/1M tokens
    // 512→747 tokens, 1K→1120, 2K→1680, 4K→2520
    // Source: https://ai.google.dev/gemini-api/docs/pricing
    pricing: { '512': 0.045, '1K': 0.067, '2K': 0.101, '4K': 0.151 }
  },
  {
    id: 'gemini-3-pro-image-preview',
    label: 'Nano Banana Pro',
    backend: 'nanobanana',
    supportsImageConfig: true,
    aspectRatios: NANO_BANANA_ASPECT_RATIOS_BASE,
    imageSizes: NANO_BANANA_SIZES_PRO,
    // 1K and 2K both use 1120 tokens at $120/1M; 4K uses 2000 tokens
    // Source: https://ai.google.dev/gemini-api/docs/pricing
    pricing: { '1K': 0.134, '2K': 0.134, '4K': 0.24 }
  },
  {
    id: 'gemini-2.5-flash-image',
    label: 'Nano Banana',
    backend: 'nanobanana',
    supportsImageConfig: true,
    aspectRatios: NANO_BANANA_ASPECT_RATIOS_BASE,
    imageSizes: NANO_BANANA_SIZES,
    // Flat per-image pricing from the current Gemini API pricing page.
    // Source: https://ai.google.dev/gemini-api/docs/pricing
    pricing: { '1K': 0.039, '2K': 0.039, '4K': 0.039 }
  }
]

// --- Grok Imagine models ---

export const GROK_MODELS: GrokModelDef[] = [
  {
    id: 'grok-imagine-image-quality',
    label: 'Grok Imagine Quality',
    backend: 'grok',
    pricing: 0.07
  },
  {
    id: 'grok-imagine-image',
    label: 'Grok Imagine',
    backend: 'grok',
    isDefault: true,
    pricing: 0.02
  }
]

// --- Text AI backends and models ---

export interface TextAIModelDef {
  id: string
  label: string
}

export interface TextAIBackendDef {
  id: string
  label: string
  models: TextAIModelDef[]
}

export const TEXT_AI_BACKENDS: TextAIBackendDef[] = [
  {
    id: 'gemini',
    label: 'Gemini',
    // Keep this aligned with publicly usable Gemini text models.
    // Gemini 3 Pro Preview is documented but marked shut down, so it is not offered here.
    models: [
      { id: 'gemini-3.5-flash',              label: 'Gemini 3.5 Flash' },
      { id: 'gemini-3-flash-preview',        label: 'Gemini 3 Flash (Preview)' },
      { id: 'gemini-3.1-flash-lite',         label: 'Gemini 3.1 Flash Lite' }
    ]
  }
]

export function getTextAIModels(backendId: string): TextAIModelDef[] {
  return TEXT_AI_BACKENDS.find((b) => b.id === backendId)?.models ?? []
}

// --- Lookup helpers ---

export function getModelsForBackend(backend: 'openai'): OpenAIModelDef[]
export function getModelsForBackend(backend: 'imagen'): ImagenModelDef[]
export function getModelsForBackend(backend: 'nanobanana'): NanoBananaModelDef[]
export function getModelsForBackend(backend: 'grok'): GrokModelDef[]
export function getModelsForBackend(backend: 'flux'): FluxModelDef[]
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

export function findModel(backend: 'openai', modelId: string): OpenAIModelDef | undefined
export function findModel(backend: 'imagen', modelId: string): ImagenModelDef | undefined
export function findModel(backend: 'nanobanana', modelId: string): NanoBananaModelDef | undefined
export function findModel(backend: 'grok', modelId: string): GrokModelDef | undefined
export function findModel(backend: 'flux', modelId: string): FluxModelDef | undefined
export function findModel(backend: BackendId, modelId: string): ModelDef | undefined {
  return getModelsForBackend(backend as 'openai').find((m) => m.id === modelId)
}

// Estimate cost for a task based on model registry
export function estimateCostFromRegistry(
  backend: BackendId,
  modelId: string,
  params: Record<string, unknown>
): number | null {
  switch (backend) {
    case 'openai': {
      const model = findModel('openai', modelId)
      if (!model) return null
      const quality = (params.quality as OpenAIQuality) || 'auto'
      if (quality === 'auto') return null
      const width = (params.width as number) || 1024
      const height = (params.height as number) || 1024
      const isSquare = width === height

      if (modelId === 'gpt-image-2') {
        // gpt-image-2 uses a token-based model that scales with image area.
        // OpenAI does not publish the per-token rate directly, but per-image prices
        // are documented for 3 anchor sizes. We extrapolate using 512-pixel tiles:
        //   tiles = ceil(W/512) × ceil(H/512)
        //   anchor tiles: 1024×1024 (square) = 4, 1024×1536 (rect) = 6
        //   cost ≈ (tiles / anchorTiles) × anchorPrice
        // This reproduces exact prices for all 3 documented sizes.
        // Source: https://platform.openai.com/docs/guides/image-generation
        const tiles = Math.ceil(width / 512) * Math.ceil(height / 512)
        const anchorTiles = isSquare ? 4 : 6
        const anchorPrice = isSquare ? model.pricing[quality].square : model.pricing[quality].rect
        return (tiles / anchorTiles) * anchorPrice
      }

      // Older GPT Image models support only the 3 fixed sizes; pricing is exact.
      return isSquare ? model.pricing[quality].square : model.pricing[quality].rect
    }
    case 'imagen': {
      const model = findModel('imagen', modelId)
      if (!model) return null
      return model.pricing
    }
    case 'flux': {
      const model = findModel('flux', modelId)
      if (!model) return null
      const width = (params.width as number) || 1024
      const height = (params.height as number) || 1024
      const mp = (width * height) / 1_000_000
      if (mp <= 1) return model.pricing.firstMp
      return model.pricing.firstMp + (mp - 1) * model.pricing.additionalMp
    }
    case 'nanobanana': {
      const model = findModel('nanobanana', modelId)
      if (!model) return null
      // Look up price by the selected image size; fall back to 1K as default
      const imageSize = (params.imageSize as string) || '1K'
      return model.pricing[imageSize] ?? model.pricing['1K'] ?? null
    }
    case 'grok': {
      const model = findModel('grok', modelId)
      if (!model) return null
      return model.pricing
    }
    case 'drawthings':
      return null
  }
}
