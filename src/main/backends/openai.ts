import OpenAI, { APIConnectionTimeoutError } from 'openai'
import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { resolveApiKey } from '../config/api-keys-store'
import { log, logApiRequest, logApiResponse, serializeError } from '../logger'
import { buildOpenAIImageParams } from './openai-request'
import { CANCELLED_MESSAGE } from './cancellation'
import { MissingApiKeyError, ProviderRefusalError, ProviderTimeoutError } from '../provider-errors'

// Calls OpenAI image generation API and returns the image bytes plus a
// MIME-type hint derived from the user-selected output_format.
export async function generateOpenAI(task: Task, signal: AbortSignal): Promise<{ buffer: Buffer; mimeType?: string }> {
  const config = loadConfig()
  const apiKey = resolveApiKey('openai.image')

  if (!apiKey) {
    throw new MissingApiKeyError('OpenAI')
  }

  // maxRetries: 0 — a generation is paid and not idempotent, so the SDK must
  // never resend one on a timeout or 5xx. The queue's failed → Retry path is the
  // only retry authority.
  const client = new OpenAI({ apiKey, timeout: config.image_backends.openai.timeout_ms, maxRetries: 0 })

  const params = buildOpenAIImageParams(task)

  logApiRequest('openai', 'images.generate', params)
  const startTime = Date.now()

  const response = await client.images.generate({
    ...params,
    prompt: task.prompt,
    n: 1,
    stream: false,
  }, { signal }).catch((err: unknown) => {
    // A stop the user asked for is not a timeout and not a failure; checked
    // first so the log does not claim otherwise.
    if (signal.aborted) throw new Error(CANCELLED_MESSAGE)
    // The SDK's timeout error keeps the plain name 'Error', so it is known by
    // its class, not its name.
    if (err instanceof APIConnectionTimeoutError || (err instanceof Error && err.name === 'AbortError')) {
      log('error', 'OpenAI API timed out', {
        model: task.model,
        timeoutMs: config.image_backends.openai.timeout_ms
      })
      throw new ProviderTimeoutError('OpenAI API', config.image_backends.openai.timeout_ms)
    }
    log('error', 'OpenAI API call failed', {
      model: task.model,
      requestParams: params,
      status: (err as Record<string, unknown>).status,
      code: (err as Record<string, unknown>).code,
      errorBody: (err as Record<string, unknown>).error,
      error: serializeError(err)
    })
    // A moderation block is a 400 like any bad parameter, told apart only by its
    // code; it is the provider refusing this prompt, so retrying it cannot help.
    if ((err as Record<string, unknown>).code === 'moderation_blocked') {
      throw new ProviderRefusalError('OpenAI blocked this prompt (moderation_blocked).', 'moderation_blocked')
    }
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
