import OpenAI from 'openai'
import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { decodeApiKey } from '../config/api-key'
import { log, logApiRequest, logApiResponse } from '../logger'

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
  // gpt-image-2 supports many more sizes than the SDK type enumerates; cast via unknown
  const size = `${width}x${height}` as unknown as '1024x1024' | '1024x1536' | '1536x1024' | 'auto'
  const quality = (task.params.quality as 'low' | 'medium' | 'high' | 'auto') || 'high'
  const outputFormat = (task.params.outputFormat as 'png' | 'jpeg' | 'webp') || 'png'
  const background = (task.params.background as 'opaque' | 'auto' | 'transparent') || 'opaque'
  const outputCompression = task.params.outputCompression as number | undefined
  const moderation = (task.params.moderation as 'auto' | 'low') || 'auto'

  const requestParams = {
    model: task.model,
    quality,
    size,
    output_format: outputFormat,
    ...(background !== 'opaque' && { background }),
    ...(outputCompression != null && { output_compression: outputCompression }),
    ...(moderation !== 'auto' && { moderation })
  }

  logApiRequest('openai', 'images.generate', requestParams)
  const startTime = Date.now()

  const response = await client.images.generate({
    ...requestParams,
    prompt: task.prompt,
    n: 1,
    stream: false
  }).catch((err: unknown) => {
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
