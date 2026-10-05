import type { ImageGenerateParamsNonStreaming } from 'openai/resources/images'
import type { Task } from '../../shared/types'
import {
  OPENAI_COMPRESSION_RANGE,
  OPENAI_IMAGE_MAX_ASPECT_RATIO,
  OPENAI_IMAGE_MAX_EDGE,
  OPENAI_IMAGE_MAX_PIXELS,
  OPENAI_IMAGE_MIN_PIXELS,
  OPENAI_IMAGE_SIZE_STEP,
  type OpenAIBackground,
  type OpenAIOutputFormat,
  type OpenAIQuality,
} from '../../shared/models'

// Pure request-shaping for the OpenAI image backend. No I/O: this builds (and
// validates) the parameters; openai.ts performs the actual API call. Kept
// separate so the conditional-field logic is unit-testable without the SDK.

// The per-request fields we send to images.generate, minus the envelope
// (prompt/n/stream) that openai.ts adds at call time and never logs. The SDK's
// quality type predates the 2.5 models' xhigh and max.
export type OpenAIImageParams = Omit<ImageGenerateParamsNonStreaming, 'prompt' | 'n' | 'stream' | 'quality'> & { quality?: OpenAIQuality }

export function validateGptImageSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error('GPT Image size must use whole-number width and height values')
  }
  if (width > OPENAI_IMAGE_MAX_EDGE || height > OPENAI_IMAGE_MAX_EDGE) {
    throw new Error(`GPT Image width and height must not exceed ${OPENAI_IMAGE_MAX_EDGE}px`)
  }
  if (width * height < OPENAI_IMAGE_MIN_PIXELS) {
    throw new Error(`GPT Image size must be at least ${OPENAI_IMAGE_MIN_PIXELS.toLocaleString()} pixels total`)
  }
  if (width % OPENAI_IMAGE_SIZE_STEP !== 0 || height % OPENAI_IMAGE_SIZE_STEP !== 0) {
    throw new Error(`GPT Image width and height must be multiples of ${OPENAI_IMAGE_SIZE_STEP}px`)
  }
  if (Math.max(width, height) / Math.min(width, height) > OPENAI_IMAGE_MAX_ASPECT_RATIO) {
    throw new Error(`GPT Image aspect ratio must stay within ${OPENAI_IMAGE_MAX_ASPECT_RATIO}:1`)
  }
  if (width * height > OPENAI_IMAGE_MAX_PIXELS) {
    throw new Error(`GPT Image size must stay at or below ${OPENAI_IMAGE_MAX_PIXELS.toLocaleString()} pixels`)
  }
}

// One branch per OpenAI image row of SUPPORTED_MODELS. An id with no row gets
// the plain request: the model alone, beside the prompt openai.ts adds.
export function buildOpenAIImageParams(task: Task): OpenAIImageParams {
  switch (task.model) {
    // Both take any size within the GPT Image custom-size rule and the GPT Image
    // fields; each row lists the qualities it takes.
    case 'gpt-image-2.5-flare':
    case 'gpt-image-2':
      return gptImageParams(task)
    default:
      return { model: task.model }
  }
}

// Every field is sent as chosen, `auto` included; a value a task does not carry
// (one queued before the field existed) is sent as the field's default.
// Moderation is not a choice: the most permissive value is always sent.
function gptImageParams(task: Task): OpenAIImageParams {
  const width = (task.params.width as number) || 1024
  const height = (task.params.height as number) || 1024
  validateGptImageSize(width, height)
  const outputFormat = (task.params.outputFormat as OpenAIOutputFormat | undefined) ?? 'png'
  const compression = task.params.outputCompression as number | undefined
  return {
    model: task.model,
    // The SDK's `size` type is `(string & {}) | 'auto' | '1024x1024' | … | null`,
    // so an arbitrary WIDTHxHEIGHT string is accepted directly.
    size: `${width}x${height}`,
    quality: (task.params.quality as OpenAIQuality | undefined) ?? 'auto',
    background: (task.params.background as OpenAIBackground | undefined) ?? 'auto',
    output_format: outputFormat,
    // Compression applies to jpeg and webp only.
    ...(outputFormat !== 'png' && { output_compression: compression ?? OPENAI_COMPRESSION_RANGE.default }),
    moderation: 'low',
  }
}
