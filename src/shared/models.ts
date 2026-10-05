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
export const OPENAI_SIZES: SizePreset[] = [
  { shape: 'square', width: 1024, height: 1024 },
  { shape: '3:2', width: 1536, height: 1024 },
  { shape: '2:3', width: 1024, height: 1536 }
]

// The app's general-purpose size ladder, shared by every surface that offers free
// choice of dimensions rather than a model-dictated list: gpt-image-2's custom
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

export type OpenAIQuality = 'low' | 'medium' | 'high' | 'auto'
export type OpenAIModeration = 'low' | 'auto'
export type OpenAIOutputFormat = 'png' | 'jpeg' | 'webp'
export type OpenAIBackground = 'opaque' | 'transparent' | 'auto'

// Display names for the one option set whose wire values do not survive a
// mechanical prettify ('webp' → 'WebP'). Each model declares which values it
// supports; these name them. Quality, moderation, and background are single
// lowercase words and are capitalized at the call site.
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
  moderations: OpenAIModeration[]
  sizes: SizePreset[]
  supportsCustomSizes?: boolean
  outputFormats: OpenAIOutputFormat[]
  backgrounds: OpenAIBackground[]
}

export interface FluxModelDef extends ModelDef {
  provider: 'bfl'
  backend: 'flux'
  sizes: SizePreset[]
  // Only FLUX.2 Flex exposes steps and guidance in the public API.
  stepsRange?: { min: number; max: number; default: number }
  guidanceRange?: { min: number; max: number; default: number }
}

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

// The Gemini 3.1 image generation (both gemini-3.1-flash-image and its Lite
// sibling) add the extra extreme ratios on top of the base set. Live-verified
// 2026-07-16: both accept 4:1 (and reject on the 3-pro / 2.5 models).
export const NANO_BANANA_ASPECT_RATIOS_FLASH2: { label: string; value: string }[] = [
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

export const NANO_BANANA_SIZES: { label: string; value: string }[] = [
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
  // Image config support varies by model and is controlled per registry entry.
  supportsImageConfig: boolean
  aspectRatios: { label: string; value: string }[]
  imageSizes: { label: string; value: string }[]
}

export type GrokAspectRatio =
  'auto' | '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3' |
  '2:1' | '1:2' | '19.5:9' | '9:19.5' | '20:9' | '9:20'

export const GROK_ASPECT_RATIOS: { label: string; value: GrokAspectRatio }[] = [
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

export const GROK_RESOLUTIONS: { label: string; value: GrokResolution }[] = [
  { label: '1K', value: '1k' },
  { label: '2K', value: '2k' }
]

// Quality is a REQUEST PARAMETER on Grok Imagine 2.0, where 1.x expressed the same idea as
// two separate model ids (grok-imagine-image / -quality). Only 2.0 declares this list, so
// only 2.0 shows the control and sends the field — the FluxModelDef stepsRange/guidanceRange
// idiom, for the same reason: a parameter belongs to the models that declare it.
//
// `auto` was live-verified on 2026-09-06 with a successful image generation. xAI says it
// currently resolves to low for generation and medium for editing; explicit low/medium pin
// the requested tier.
//
// Sending `quality: "ultra"` made the DESERIALIZER answer `unknown variant \`ultra\`,
// expected one of \`low\`, \`medium\`, \`high\``, which read like the contract and was not:
// that is a shared wire enum, while actually generating with `high` on 2.0 returns 400.
// `auto` was added later and is accepted even though that older error did not name it.
//
// So a deserializer error names a parser TYPE, while a successful request proves the
// per-model CONTRACT. An intermediate version of this list shipped `high` on the strength
// of the parse error alone. Verify a value by using it, not by watching the parser refuse
// a different one.
export type GrokQuality = 'low' | 'medium' | 'high' | 'auto'

// This list is what 2.0 offers, not every value Grok's shared parser can name.
export const GROK_QUALITY_VALUES: { label: string; value: GrokQuality }[] = [
  { label: 'Low',    value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'Auto',   value: 'auto' }
]

export interface GrokModelDef extends ModelDef {
  provider: 'xai'
  backend: 'grok'
  aspectRatios: { label: string; value: GrokAspectRatio }[]
  resolutions: { label: string; value: GrokResolution }[]
  // Only Grok Imagine 2.0 takes a `quality` parameter; the 1.x pair encode the same
  // choice in their model ids. Absent means the field is neither shown nor sent.
  qualities?: { label: string; value: GrokQuality }[]
}

