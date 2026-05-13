import OpenAI from 'openai'
import type { ImageGenerateParamsNonStreaming } from 'openai/resources/images'
import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { decodeApiKey } from '../config/api-key'
import { log, logApiRequest, logApiResponse } from '../logger'
import {
  OPENAI_GPT2_MAX_ASPECT_RATIO,
  OPENAI_GPT2_MAX_EDGE,
  OPENAI_GPT2_MAX_PIXELS,
  OPENAI_GPT2_MIN_EDGE,
  OPENAI_GPT2_SIZE_STEP,
} from '../../shared/models'

function validateGptImage2Size(width: number, height: number): void {
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

// Calls OpenAI image generation API and returns the image bytes plus a
// MIME-type hint derived from the user-selected output_format.
export async function generateOpenAI(task: Task): Promise<{ buffer: Buffer; mimeType?: string }> {
  const config = loadConfig()
  const apiKey = decodeApiKey(config.image_backends.openai.api_key)

  if (!apiKey) {
    throw new Error('OpenAI API key not configured')
  }

  const client = new OpenAI({ apiKey, timeout: config.image_backends.openai.timeout_ms })

  const width = (task.params.width as number) || 1024
  const height = (task.params.height as number) || 1024
  if (task.model === 'gpt-image-2') validateGptImage2Size(width, height)
  // gpt-image-2 supports many more sizes than the SDK type enumerates.
  const size = `${width}x${height}`
  const moderation = (task.params.moderation as 'auto' | 'low') || 'auto'
  const quality = (task.params.quality as 'low' | 'medium' | 'high' | 'auto') || 'auto'
  const outputFormat = (task.params.outputFormat as 'png' | 'jpeg' | 'webp') || 'png'
  const background = (task.params.background as 'opaque' | 'auto' | 'transparent') || 'opaque'
  const outputCompression = task.params.outputCompression as number | undefined

  const requestParams = {
    model: task.model,
    size,
    ...(moderation !== 'auto' && { moderation }),
    ...(quality !== 'auto' && { quality }),
    output_format: outputFormat,
    ...(background !== 'opaque' && { background }),
    ...(outputCompression != null && { output_compression: outputCompression }),
  }

  logApiRequest('openai', 'images.generate', requestParams)
  const startTime = Date.now()

  const response = await client.images.generate({
    ...requestParams,
    prompt: task.prompt,
    n: 1,
    stream: false
  } as unknown as ImageGenerateParamsNonStreaming).catch((err: unknown) => {
    log('error', 'OpenAI API call failed', {
      model: task.model,
      requestParams,
      status: (err as Record<string, unknown>).status,
      code: (err as Record<string, unknown>).code,
      errorBody: (err as Record<string, unknown>).error,
      message: err instanceof Error ? err.message : String(err)
    })
    throw err
  })

  logApiResponse('openai', 'ok', Date.now() - startTime)

  const b64 = response.data?.[0]?.b64_json
  if (!b64) {
    log('error', 'OpenAI response missing image data', { model: task.model })
    throw new Error('No image data in OpenAI response')
  }

  const mimeType =
    outputFormat === 'jpeg' ? 'image/jpeg' :
    outputFormat === 'webp' ? 'image/webp' :
    'image/png'

  return { buffer: Buffer.from(b64, 'base64'), mimeType }
}
