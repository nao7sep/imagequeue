// Centralized model registry — single source of truth for models, sizes, parameters, and pricing.

import { BackendId } from './types'

// --- Size presets ---

export interface SizePreset {
  label: string
  width: number
  height: number
}

// OpenAI supports exactly these three sizes
export const OPENAI_SIZES: SizePreset[] = [
  { label: '1024×1024 (Square)', width: 1024, height: 1024 },
  { label: '1024×1536 (Portrait)', width: 1024, height: 1536 },
  { label: '1536×1024 (Landscape)', width: 1536, height: 1024 }
]

// Google uses aspect ratios; sizes are "1K" or "2K"
export type GoogleAspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9'
export type GoogleImageSize = '1024x1024' | '2048x2048'

export const GOOGLE_ASPECT_RATIOS: { label: string; value: GoogleAspectRatio }[] = [
  { label: '1:1 (Square)', value: '1:1' },
  { label: '3:4 (Portrait)', value: '3:4' },
  { label: '4:3 (Landscape)', value: '4:3' },
  { label: '9:16 (Tall)', value: '9:16' },
  { label: '16:9 (Wide)', value: '16:9' }
]

export const GOOGLE_IMAGE_SIZES: { label: string; value: GoogleImageSize }[] = [
  { label: '1K (1024×1024)', value: '1024x1024' },
  { label: '2K (2048×2048)', value: '2048x2048' }
]

// FLUX: common presets (multiples of 16, ≤4MP)
export const FLUX_SIZES: SizePreset[] = [
  { label: '1024×1024 (Square)', width: 1024, height: 1024 },
  { label: '1024×1536 (Portrait)', width: 1024, height: 1536 },
  { label: '1536×1024 (Landscape)', width: 1536, height: 1024 },
  { label: '768×1344 (Portrait)', width: 768, height: 1344 },
  { label: '1344×768 (Landscape)', width: 1344, height: 768 },
  { label: '1408×1408 (Square 2MP)', width: 1408, height: 1408 },
  { label: '2048×2048 (Square 4MP)', width: 2048, height: 2048 },
  { label: '1536×2048 (Portrait 3MP)', width: 1536, height: 2048 },
  { label: '2048×1536 (Landscape 3MP)', width: 2048, height: 1536 }
]

// Local: common sizes for Draw Things
export const LOCAL_SIZES: SizePreset[] = [
  { label: '512×512', width: 512, height: 512 },
  { label: '768×768', width: 768, height: 768 },
  { label: '1024×1024', width: 1024, height: 1024 },
  { label: '768×1024 (Portrait)', width: 768, height: 1024 },
  { label: '1024×768 (Landscape)', width: 1024, height: 768 },
  { label: '1024×1536 (Portrait)', width: 1024, height: 1536 },
  { label: '1536×1024 (Landscape)', width: 1536, height: 1024 }
]

// --- Model definitions ---

export type OpenAIQuality = 'low' | 'medium' | 'high'
export type OpenAIOutputFormat = 'png' | 'jpeg' | 'webp'
export type OpenAIBackground = 'opaque' | 'transparent'
export type GooglePersonGeneration = 'dont_allow' | 'allow_adult' | 'allow_all'

export interface ModelDef {
  id: string
  label: string
  backend: BackendId
}

export interface OpenAIModelDef extends ModelDef {
  backend: 'openai'
  qualities: OpenAIQuality[]
  sizes: SizePreset[]
  outputFormats: OpenAIOutputFormat[]
  backgrounds: OpenAIBackground[]
  pricing: Record<OpenAIQuality, { square: number; rect: number }>
}

export interface GoogleModelDef extends ModelDef {
  backend: 'google'
  aspectRatios: typeof GOOGLE_ASPECT_RATIOS
  imageSizes: typeof GOOGLE_IMAGE_SIZES
  maxImages: number
  personGeneration: GooglePersonGeneration[]
  pricing: number
}

export interface FluxModelDef extends ModelDef {
  backend: 'flux'
  sizes: SizePreset[]
  stepsRange: { min: number; max: number; default: number }
  guidanceRange: { min: number; max: number; default: number }
  pricing: { firstMp: number; additionalMp: number }
}

export interface LocalModelDef extends ModelDef {
  backend: 'local'
  sizes: SizePreset[]
  stepsRange: { min: number; max: number; default: number }
  guidanceRange: { min: number; max: number; default: number }
  filename: string
}

export interface NanoBananaModelDef extends ModelDef {
  backend: 'nanobanana'
  pricing: number  // per image at 1K resolution
}

// --- OpenAI models ---

export const OPENAI_MODELS: OpenAIModelDef[] = [
  {
    id: 'gpt-image-1.5',
    label: 'GPT Image 1.5',
    backend: 'openai',
    qualities: ['low', 'medium', 'high'],
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
    qualities: ['low', 'medium', 'high'],
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
    qualities: ['low', 'medium', 'high'],
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

// --- Google models ---

export const GOOGLE_MODELS: GoogleModelDef[] = [
  {
    id: 'imagen-4.0-fast-generate-001',
    label: 'Imagen 4 Fast',
    backend: 'google',
    aspectRatios: GOOGLE_ASPECT_RATIOS,
    imageSizes: GOOGLE_IMAGE_SIZES,
    maxImages: 4,
    personGeneration: ['dont_allow', 'allow_adult', 'allow_all'],
    pricing: 0.02
  },
  {
    id: 'imagen-4.0-generate-001',
    label: 'Imagen 4',
    backend: 'google',
    aspectRatios: GOOGLE_ASPECT_RATIOS,
    imageSizes: GOOGLE_IMAGE_SIZES,
    maxImages: 4,
    personGeneration: ['dont_allow', 'allow_adult', 'allow_all'],
    pricing: 0.04
  },
  {
    id: 'imagen-4.0-ultra-generate-001',
    label: 'Imagen 4 Ultra',
    backend: 'google',
    aspectRatios: GOOGLE_ASPECT_RATIOS,
    imageSizes: GOOGLE_IMAGE_SIZES,
    maxImages: 4,
    personGeneration: ['dont_allow', 'allow_adult', 'allow_all'],
    pricing: 0.06
  }
]

// --- FLUX models ---

export const FLUX_MODELS: FluxModelDef[] = [
  {
    id: 'flux-2-max',
    label: 'FLUX.2 Max',
    backend: 'flux',
    sizes: FLUX_SIZES,
    stepsRange: { min: 1, max: 60, default: 40 },
    guidanceRange: { min: 1, max: 20, default: 7 },
    pricing: { firstMp: 0.07, additionalMp: 0.03 }
  },
  {
    id: 'flux-2-pro',
    label: 'FLUX.2 Pro',
    backend: 'flux',
    sizes: FLUX_SIZES,
    stepsRange: { min: 1, max: 60, default: 40 },
    guidanceRange: { min: 1, max: 20, default: 7 },
    pricing: { firstMp: 0.03, additionalMp: 0.015 }
  },
  {
    id: 'flux-2-flex',
    label: 'FLUX.2 Flex',
    backend: 'flux',
    sizes: FLUX_SIZES,
    stepsRange: { min: 1, max: 60, default: 40 },
    guidanceRange: { min: 1, max: 20, default: 7 },
    pricing: { firstMp: 0.06, additionalMp: 0 }
  },
  {
    id: 'flux-2-klein-9b-preview',
    label: 'FLUX.2 Klein 9B',
    backend: 'flux',
    sizes: FLUX_SIZES,
    stepsRange: { min: 1, max: 60, default: 28 },
    guidanceRange: { min: 1, max: 20, default: 7 },
    pricing: { firstMp: 0.015, additionalMp: 0.002 }
  },
  {
    id: 'flux-2-klein-4b',
    label: 'FLUX.2 Klein 4B',
    backend: 'flux',
    sizes: FLUX_SIZES,
    stepsRange: { min: 1, max: 60, default: 28 },
    guidanceRange: { min: 1, max: 20, default: 7 },
    pricing: { firstMp: 0.014, additionalMp: 0.001 }
  }
]

// --- Local (Draw Things) models ---

export const LOCAL_MODELS: LocalModelDef[] = [
  {
    id: 'flux_1_schnell_q5p.ckpt',
    label: 'FLUX.1 Schnell (Q5P)',
    backend: 'local',
    sizes: LOCAL_SIZES,
    stepsRange: { min: 1, max: 20, default: 4 },
    guidanceRange: { min: 1, max: 20, default: 1 },
    filename: 'flux_1_schnell_q5p.ckpt'
  },
  {
    id: 'flux_1_schnell_q8p.ckpt',
    label: 'FLUX.1 Schnell (Q8P)',
    backend: 'local',
    sizes: LOCAL_SIZES,
    stepsRange: { min: 1, max: 20, default: 4 },
    guidanceRange: { min: 1, max: 20, default: 1 },
    filename: 'flux_1_schnell_q8p.ckpt'
  },
  {
    id: 'flux_1_dev_q8p.ckpt',
    label: 'FLUX.1 Dev (Q8P)',
    backend: 'local',
    sizes: LOCAL_SIZES,
    stepsRange: { min: 1, max: 50, default: 20 },
    guidanceRange: { min: 1, max: 20, default: 3.5 },
    filename: 'flux_1_dev_q8p.ckpt'
  },
  {
    id: 'flux_2_klein_4b_q6p.ckpt',
    label: 'FLUX.2 Klein 4B (Q6P)',
    backend: 'local',
    sizes: LOCAL_SIZES,
    stepsRange: { min: 1, max: 50, default: 4 },
    guidanceRange: { min: 1, max: 20, default: 1 },
    filename: 'flux_2_klein_4b_q6p.ckpt'
  },
  {
    id: 'sd3_medium_q6p.ckpt',
    label: 'SD3 Medium (Q6P)',
    backend: 'local',
    sizes: LOCAL_SIZES,
    stepsRange: { min: 1, max: 50, default: 28 },
    guidanceRange: { min: 1, max: 20, default: 7 },
    filename: 'sd3_medium_q6p.ckpt'
  },
  {
    id: 'sdxl_base_v1.0_q6p.ckpt',
    label: 'SDXL Base 1.0 (Q6P)',
    backend: 'local',
    sizes: LOCAL_SIZES,
    stepsRange: { min: 1, max: 50, default: 30 },
    guidanceRange: { min: 1, max: 20, default: 7 },
    filename: 'sdxl_base_v1.0_q6p.ckpt'
  }
]

// --- Nano Banana (Gemini native image generation) models ---

export const NANO_BANANA_MODELS: NanoBananaModelDef[] = [
  {
    id: 'gemini-2.5-flash-image',
    label: 'Nano Banana',
    backend: 'nanobanana',
    pricing: 0.067  // $0.067/1K image (standard API, ai.google.dev/pricing)
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    label: 'Nano Banana 2',
    backend: 'nanobanana',
    pricing: 0.067  // $0.067/1K image (standard API, ai.google.dev/pricing)
  },
  {
    id: 'gemini-3-pro-image-preview',
    label: 'Nano Banana Pro',
    backend: 'nanobanana',
    pricing: 0.134  // $0.134/1K–2K image (standard API, ai.google.dev/pricing)
  }
]

// --- Lookup helpers ---

export function getModelsForBackend(backend: 'openai'): OpenAIModelDef[]
export function getModelsForBackend(backend: 'google'): GoogleModelDef[]
export function getModelsForBackend(backend: 'flux'): FluxModelDef[]
export function getModelsForBackend(backend: 'local'): LocalModelDef[]
export function getModelsForBackend(backend: 'nanobanana'): NanoBananaModelDef[]
export function getModelsForBackend(backend: BackendId): ModelDef[] {
  switch (backend) {
    case 'openai': return OPENAI_MODELS
    case 'google': return GOOGLE_MODELS
    case 'flux': return FLUX_MODELS
    case 'local': return LOCAL_MODELS
    case 'nanobanana': return NANO_BANANA_MODELS
  }
}

export function findModel(backend: 'openai', modelId: string): OpenAIModelDef | undefined
export function findModel(backend: 'google', modelId: string): GoogleModelDef | undefined
export function findModel(backend: 'flux', modelId: string): FluxModelDef | undefined
export function findModel(backend: 'local', modelId: string): LocalModelDef | undefined
export function findModel(backend: 'nanobanana', modelId: string): NanoBananaModelDef | undefined
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
      const quality = (params.quality as OpenAIQuality) || 'high'
      const width = (params.width as number) || 1024
      const height = (params.height as number) || 1024
      const isSquare = width === height
      return isSquare ? model.pricing[quality].square : model.pricing[quality].rect
    }
    case 'google': {
      const model = findModel('google', modelId)
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
      return model.pricing
    }
    case 'local':
      return null
  }
}
