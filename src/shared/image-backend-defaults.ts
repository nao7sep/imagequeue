import { getDefaultModelForBackend } from './ai-models'
import { OPENAI_COMPRESSION_RANGE } from './models'

// Each cloud image column's starting parameters, for a fresh install's
// settings and for a column whose saved parameters are missing. One source for
// both, so a new install and a reset column start the same.
export const IMAGE_DEFAULT_PARAMS = {
  openai: {
    width: 1024,
    height: 1024,
    quality: 'auto',
    outputFormat: 'png',
    outputCompression: OPENAI_COMPRESSION_RANGE.default,
    background: 'auto',
  },
  nanobanana: {
    aspectRatio: '1:1',
    imageSize: '1K',
    thinking: getDefaultModelForBackend('nanobanana').defaultThinking,
  },
  grok: {
    aspectRatio: '1:1',
    resolution: '1k',
    // `auto` is the API's own default, sent as chosen; low and medium are
    // xAI's two real levels, so medium is the higher one, not a middle.
    quality: 'auto',
  },
  // The default row's parameters. No steps/guidance: they apply only to a
  // model that declares their ranges, and that model's own defaults are the
  // source.
  flux: {
    aspectRatio: '1:1',
    resolution: '1k',
  },
} as const

// Draw Things' fallbacks, used where a model has neither saved parameters nor a
// recommendation, and by the column before settings have arrived.
export const DRAWTHINGS_FALLBACK_PARAMS = {
  fallback_width: 1024,
  fallback_height: 1024,
  fallback_steps: 4,
  fallback_guidance: 1,
  fallback_negative_prompt: '',
  seed: null,
} as const
