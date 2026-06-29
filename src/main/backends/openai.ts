import OpenAI from 'openai'
import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { resolveApiKey } from '../config/api-keys-store'
import { log, logApiRequest, logApiResponse, serializeError } from '../logger'
import { buildOpenAIImageParams } from './openai-request'

// Calls OpenAI image generation API and returns the image bytes plus a
// MIME-type hint derived from the user-selected output_format.
export async function generateOpenAI(task: Task): Promise<{ buffer: Buffer; mimeType?: string }> {
  const config = loadConfig()
  const apiKey = resolveApiKey('openai.image')

  if (!apiKey) {
    throw new Error('OpenAI API key not configured')
  }

  const client = new OpenAI({ apiKey, timeout: config.image_backends.openai.timeout_ms })

  const params = buildOpenAIImageParams(task)

  logApiRequest('openai', 'images.generate', params)
  const startTime = Date.now()

  const response = await client.images.generate({
    ...params,
    prompt: task.prompt,
    n: 1,
    stream: false,
  }).catch((err: unknown) => {
    if (
      err instanceof Error &&
      (err.name === 'AbortError' ||
        err.name === 'APITimeoutError' ||
        err.name === 'APIConnectionTimeoutError')
    ) {
      log('error', 'OpenAI API timed out', {
        model: task.model,
        timeoutMs: config.image_backends.openai.timeout_ms
      })
      throw new Error(`OpenAI API timed out after ${config.image_backends.openai.timeout_ms / 1000}s`)
    }
    log('error', 'OpenAI API call failed', {
      model: task.model,
      requestParams: params,
      status: (err as Record<string, unknown>).status,
      code: (err as Record<string, unknown>).code,
      errorBody: (err as Record<string, unknown>).error,
      error: serializeError(err)
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
    params.output_format === 'jpeg' ? 'image/jpeg' :
    params.output_format === 'webp' ? 'image/webp' :
    'image/png'

  return { buffer: Buffer.from(b64, 'base64'), mimeType }
}
