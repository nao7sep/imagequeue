import type { ImageGenerateParamsNonStreaming } from 'openai/resources/images'
import type { Task } from '../../shared/types'
import {
  OPENAI_GPT2_MAX_ASPECT_RATIO,
  OPENAI_GPT2_MAX_EDGE,
  OPENAI_GPT2_MAX_PIXELS,
  OPENAI_GPT2_MIN_EDGE,
  OPENAI_GPT2_SIZE_STEP,
} from '../../shared/models'

// Pure request-shaping for the OpenAI image backend. No I/O: this builds (and
// validates) the parameters; openai.ts performs the actual API call. Kept
// separate so the conditional-field logic is unit-testable without the SDK.

// The per-request fields we send to images.generate, minus the envelope
// (prompt/n/stream) that openai.ts adds at call time and never logs.
export type OpenAIImageParams = Omit<ImageGenerateParamsNonStreaming, 'prompt' | 'n' | 'stream'>

export function validateGptImage2Size(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error('GPT Image 2 size must use whole-number width and height values')
  }
  if (width < OPENAI_GPT2_MIN_EDGE || height < OPENAI_GPT2_MIN_EDGE) {
    throw new Error(`GPT Image 2 width and height must be at least ${OPENAI_GPT2_MIN_EDGE}px`)
  }
  if (width > OPENAI_GPT2_MAX_EDGE || height > OPENAI_GPT2_MAX_EDGE) {
    throw new Error(`GPT Image 2 width and height must not exceed ${OPENAI_GPT2_MAX_EDGE}px`)
  }
  if (width % OPENAI_GPT2_SIZE_STEP !== 0 || height % OPENAI_GPT2_SIZE_STEP !== 0) {
    throw new Error(`GPT Image 2 width and height must be multiples of ${OPENAI_GPT2_SIZE_STEP}px`)
  }
  if (Math.max(width, height) / Math.min(width, height) > OPENAI_GPT2_MAX_ASPECT_RATIO) {
    throw new Error(`GPT Image 2 aspect ratio must stay within ${OPENAI_GPT2_MAX_ASPECT_RATIO}:1`)
  }
  if (width * height > OPENAI_GPT2_MAX_PIXELS) {
    throw new Error(`GPT Image 2 size must stay at or below ${OPENAI_GPT2_MAX_PIXELS.toLocaleString()} pixels`)
  }
}

// Builds the images.generate parameters from a task's params. Fields that the
// API treats as defaults (moderation=auto, quality=auto, background=opaque) are
// omitted rather than sent, matching the API's own defaulting.
export function buildOpenAIImageParams(task: Task): OpenAIImageParams {
  const width = (task.params.width as number) || 1024
  const height = (task.params.height as number) || 1024
  if (task.model === 'gpt-image-2') validateGptImage2Size(width, height)

  const size = `${width}x${height}`
  const moderation = (task.params.moderation as 'auto' | 'low') || 'auto'
  const quality = (task.params.quality as 'low' | 'medium' | 'high' | 'auto') || 'auto'
  const outputFormat = (task.params.outputFormat as 'png' | 'jpeg' | 'webp') || 'png'
  const background = (task.params.background as 'opaque' | 'auto' | 'transparent') || 'opaque'
  const outputCompression = task.params.outputCompression as number | undefined

  return {
    model: task.model,
    // The SDK's `size` type is `(string & {}) | 'auto' | '1024x1024' | … | null`,
    // so an arbitrary WIDTHxHEIGHT string is accepted directly — gpt-image-2's
    // custom sizes (validated above) need no special handling here.
    size,
    output_format: outputFormat,
    ...(moderation !== 'auto' && { moderation }),
    ...(quality !== 'auto' && { quality }),
    ...(background !== 'opaque' && { background }),
    ...(outputCompression != null && { output_compression: outputCompression }),
  }
}
