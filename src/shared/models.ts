// The image rows' capability types and shared size ladders. The rows themselves
// are SUPPORTED_MODELS in ai-models.ts.

import type { BackendId } from './types'

// --- Size presets ---

// A preset's shape: its aspect ratio ('3:2'), or a named format the renderer
// words in the interface language (see sizePresetLabel).
export type SizeShape =
  | 'square' | 'squareLarge'
  | 'a4Wide' | 'letterWide' | 'qhdWide' | 'uhdWide'
  | 'a4Tall' | 'letterTall' | 'qhdTall' | 'uhdTall'
  | `${number}:${number}`

export interface SizePreset {
  shape: SizeShape
  width: number
  height: number
}

// The GPT Image custom-size rule (OpenAI image-generation docs), shared by
// every OpenAI image row.
//
// The API's real lower bound is a MINIMUM TOTAL PIXEL COUNT, not a per-edge
// minimum — a small-area size like 1024x512 (524,288 px) is rejected by the API
// even though both edges are large. That area rule is OPENAI_IMAGE_MIN_PIXELS,
// enforced at request time in validateGptImageSize (openai-request.ts).
//
// OPENAI_IMAGE_MIN_EDGE is a separate, softer concern: the per-edge floor the
// renderer clamps the width/height INPUT controls to, so a single dimension can't
// be normalized to something absurd. It is NOT the API constraint — a per-edge-valid
// pair can still be too small in area and is rejected by the min-pixels check.
export const OPENAI_IMAGE_MIN_EDGE = 512
export const OPENAI_IMAGE_MIN_PIXELS = 655_360
export const OPENAI_IMAGE_MAX_EDGE = 3840
export const OPENAI_IMAGE_SIZE_STEP = 16
export const OPENAI_IMAGE_MAX_ASPECT_RATIO = 3
export const OPENAI_IMAGE_MAX_PIXELS = 8_294_400

// Output compression, for jpeg and webp only.
export const OPENAI_COMPRESSION_RANGE = { min: 0, max: 100, default: 100 }

// The app's general-purpose size ladder, shared by every surface that offers free
// choice of dimensions rather than a model-dictated list: GPT Image's custom
// sizing, FLUX (filtered to its 4MP ceiling), and Draw Things. Shared deliberately
// — editing an entry moves all three, which is the intent; a backend needing its
// own ladder gets its own constant rather than a divergent copy of this one.
export const STANDARD_SIZE_PRESETS: SizePreset[] = [
  { shape: 'square', width: 1024, height: 1024 },
  { shape: 'squareLarge', width: 2048, height: 2048 },
  { shape: '2:1', width: 2048, height: 1024 },
  { shape: '16:9', width: 2048, height: 1152 },
  { shape: '3:2', width: 2048, height: 1360 },
  { shape: 'a4Wide', width: 2048, height: 1456 },
  { shape: '4:3', width: 2048, height: 1536 },
  { shape: 'letterWide', width: 2048, height: 1584 },
  { shape: 'qhdWide', width: 2560, height: 1440 },
  { shape: 'uhdWide', width: 3840, height: 2160 },
  { shape: '1:2', width: 1024, height: 2048 },
  { shape: '9:16', width: 1152, height: 2048 },
  { shape: '2:3', width: 1360, height: 2048 },
  { shape: 'a4Tall', width: 1456, height: 2048 },
  { shape: '3:4', width: 1536, height: 2048 },
  { shape: 'letterTall', width: 1584, height: 2048 },
  { shape: 'qhdTall', width: 1440, height: 2560 },
  { shape: 'uhdTall', width: 2160, height: 3840 }
]

// FLUX.2's dimension limits, named here beside the OpenAI equivalents above and
// exported for the FLUX backend to validate against — the ladder below and that
// check must agree, so they read the same constants.
export const FLUX_MAX_PIXELS = 4_194_304
export const FLUX_SIZE_STEP = 16

// FLUX.2 allows flexible sizes up to its ceiling: the standard ladder, minus what
// does not fit.
export const FLUX_SIZES: SizePreset[] = STANDARD_SIZE_PRESETS.filter(
  ({ width, height }) => width * height <= FLUX_MAX_PIXELS
)

// --- Model definitions ---

export type OpenAIQuality = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type OpenAIOutputFormat = 'png' | 'jpeg' | 'webp'
export type OpenAIBackground = 'auto' | 'transparent' | 'opaque'

// The formats a transparent background can be saved in.
export const OPENAI_TRANSPARENT_FORMATS: readonly OpenAIOutputFormat[] = ['png', 'webp']

// Display names for the one option set whose wire values do not survive a
// mechanical prettify ('webp' → 'WebP'). Each model declares which values it
// supports; these name them. Quality and background values are labelled in the
// interface language at the call site.
export const OPENAI_OUTPUT_FORMAT_LABELS: Record<OpenAIOutputFormat, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP'
}

export type ImageKind = 'image-generate'
// An image row's provider is its api-key id; its backend is the column it belongs to.
export type ImageProviderId = 'openai' | 'gemini' | 'xai' | 'bfl'

export interface ModelDef {
  provider: ImageProviderId
  id: string
  label: string
  backend: BackendId
  kinds: readonly ImageKind[]
  defaultFor: readonly ImageKind[]
}

export interface OpenAIModelDef extends ModelDef {
  provider: 'openai'
  backend: 'openai'
  qualities: OpenAIQuality[]
  // Presets for the size field; any size within the custom-size rule is also taken.
  sizes: SizePreset[]
  outputFormats: OpenAIOutputFormat[]
  backgrounds: OpenAIBackground[]
}

export type FluxOutputFormat = 'png' | 'jpeg' | 'webp'

export interface FluxModelDef extends ModelDef {
  provider: 'bfl'
  backend: 'flux'
  // FLUX.2 takes a width and height from this ladder, an output format and a seed.
  sizes?: SizePreset[]
  outputFormats?: FluxOutputFormat[]
  // FLUX 3 takes an aspect ratio and a resolution level instead, and returns png.
  aspectRatios?: { label: string; value: string }[]
  resolutions?: { label: string; value: string }[]
  // Only FLUX.2 Flex exposes steps and guidance in the public API.
  stepsRange?: { min: number; max: number; default: number }
  guidanceRange?: { min: number; max: number; default: number }
}

// FLUX 3's ratios: auto, then BFL's own order from 21:9 to 9:21.
export const FLUX_3_ASPECT_RATIOS: { label: string; value: string }[] = [
  'auto', '21:9', '2:1', '16:9', '3:2', '7:5', '4:3', '5:4', '1:1', '4:5', '3:4', '5:7', '2:3', '9:16', '1:2', '9:21',
].map((value) => ({ label: value === 'auto' ? 'Auto' : value, value }))

export const FLUX_3_RESOLUTIONS: { label: string; value: string }[] = [
  { label: '768 sq', value: '768sq' },
  { label: '1K', value: '1k' },
  { label: '1.5K', value: '1.5k' },
  { label: '2K', value: '2k' },
  { label: '4K', value: '4k' },
]

// Nano Banana (Gemini native image generation) aspect ratios and sizes.
// Source: https://ai.google.dev/gemini-api/docs/image-generation
export const NANO_BANANA_ASPECT_RATIOS_BASE: { label: string; value: string }[] = [
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

// The 3.1 Flash pair add the four extreme ratios, in Google's own order. Lite's
// older model page lists 10, but Google's guide lists all 14 for it.
export const NANO_BANANA_ASPECT_RATIOS_FLASH2: { label: string; value: string }[] = [
  '1:1', '1:4', '4:1', '1:8', '8:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9',
].map((ratio) => ({ label: ratio, value: ratio }))

export const NANO_BANANA_SIZES_FLASH2: { label: string; value: string }[] = [
  { label: '0.5K', value: '512' },
  { label: '1K',   value: '1K' },
  { label: '2K',   value: '2K' },
  { label: '4K',   value: '4K' }
]

export const NANO_BANANA_SIZES_PRO: { label: string; value: string }[] = [
  { label: '1K', value: '1K' },
  { label: '2K', value: '2K' },
  { label: '4K', value: '4K' }
]

// Nano Banana 2 Lite (Gemini 3.1 Flash-Lite Image) generates at 1K only.
export const NANO_BANANA_SIZES_LITE: { label: string; value: string }[] = [
  { label: '1K', value: '1K' }
]

export interface NanoBananaModelDef extends ModelDef {
  provider: 'gemini'
  backend: 'nanobanana'
  aspectRatios: { label: string; value: string }[]
  imageSizes: { label: string; value: string }[]
  // The thinking levels the model takes, in Google's words, lowest first.
  thinking: string[]
  defaultThinking: string
}

// Both xAI rows take auto, then the 15 ratios in xAI's own order.
export const GROK_ASPECT_RATIO_VALUES = [
  'auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1', '1:2',
  '19.5:9', '9:19.5', '20:9', '9:20', '21:9', '5:2',
] as const
export type GrokAspectRatio = (typeof GROK_ASPECT_RATIO_VALUES)[number]

export const GROK_ASPECT_RATIOS: { label: string; value: GrokAspectRatio }[] =
  GROK_ASPECT_RATIO_VALUES.map((value) => ({ label: value === 'auto' ? 'Auto' : value, value }))

export type GrokResolution = '1k' | '1.5k' | '2k'

// 2.0 takes 1.5k; grok-imagine-image refuses it.
export const GROK_RESOLUTIONS_2: { label: string; value: GrokResolution }[] = [
  { label: '1K', value: '1k' },
  { label: '1.5K', value: '1.5k' },
  { label: '2K', value: '2k' }
]

export const GROK_RESOLUTIONS: { label: string; value: GrokResolution }[] = [
  { label: '1K', value: '1k' },
  { label: '2K', value: '2k' }
]

// Quality is a request parameter on Grok Imagine 2.0 alone. xAI offers two real
// levels, so medium is the higher of two; auto is the API's literal default,
// which xAI resolves to low when generating.
export type GrokQuality = 'auto' | 'low' | 'medium'

export const GROK_QUALITY_VALUES: { label: string; value: GrokQuality }[] = [
  { label: 'Auto',   value: 'auto' },
  { label: 'Low',    value: 'low' },
  { label: 'Medium', value: 'medium' }
]

export interface GrokModelDef extends ModelDef {
  provider: 'xai'
  backend: 'grok'
  aspectRatios: { label: string; value: GrokAspectRatio }[]
  resolutions: { label: string; value: GrokResolution }[]
  // Only Grok Imagine 2.0 takes a `quality` parameter; the 1.x id encodes the same
  // choice in their model ids. Absent means the field is neither shown nor sent.
  qualities?: { label: string; value: GrokQuality }[]
}

