import OpenAI, { APIConnectionTimeoutError, APIError } from 'openai'
import type { ImageGenerateParamsNonStreaming } from 'openai/resources/images'
import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { resolveApiKey } from '../config/api-keys-store'
import { log, serializeError } from '../logger'
import { recordAiCall, recordingFetch, type AiCall } from '../records'
import { buildOpenAIImageParams } from './openai-request'
import { CANCELLED_MESSAGE } from './cancellation'
import { MissingApiKeyError, ProviderHttpError, ProviderRefusalError, ProviderTimeoutError } from '../provider-errors'
import { openaiReasonField, reasonFromParsed } from '../provider-reason'
import { withProviderRetry } from '../provider-retry'

// Calls OpenAI image generation API and returns the image bytes plus a
// MIME-type hint derived from the user-selected output_format.
export async function generateOpenAI(task: Task, signal: AbortSignal): Promise<{ buffer: Buffer; mimeType?: string }> {
  const config = loadConfig()
  const apiKey = resolveApiKey('openai.image')

  if (!apiKey) {
    throw new MissingApiKeyError('OpenAI')
  }

  const params = buildOpenAIImageParams(task)
  const request = { ...params, prompt: task.prompt, n: 1, stream: false as const }

  const response = await withProviderRetry((attemptSignal) => {
    // Each attempt's record keeps the HTTP request the SDK sends.
    const call: AiCall = { backend: 'openai', model: task.model, purpose: 'image', taskId: task.id, request }
    // The app owns retries; the SDK performs exactly one attempt.
    const client = new OpenAI({ apiKey, timeout: config.image_backends.openai.timeout_ms, maxRetries: 0, fetch: recordingFetch(call) })
    return recordAiCall(
      call,
      // The SDK's quality type predates xhigh and max; the body is sent as built.
      () => client.images.generate(request as ImageGenerateParamsNonStreaming, { signal: attemptSignal }),
      // The image bytes are the saved file's.
      (answer) => ({ ...answer, data: answer.data?.map(({ b64_json: _bytes, ...rest }) => rest) }),
    ).catch((err: unknown) => {
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
      // The API's own explanation is the `message` of the error body the SDK
      // keeps on `error` — the provider's words, without the SDK's status prefix.
      const said = err instanceof APIError ? reasonFromParsed(err.error, openaiReasonField) : null
      // A moderation block is a 400 like any bad parameter, told apart only by its
      // code; it is the provider refusing this prompt, so retrying it cannot help.
      if ((err as Record<string, unknown>).code === 'moderation_blocked') {
        throw new ProviderRefusalError('OpenAI blocked this prompt (moderation_blocked).', 'moderation_blocked', said)
      }
      // Any other answer with a status keeps that status (presentation and retry
      // policy read it) and carries the provider's explanation with it.
      if (err instanceof APIError && typeof err.status === 'number') {
        throw new ProviderHttpError(err.message, err.status, said, err.headers?.get('retry-after') ?? null)
      }
      throw err
    })
  }, { signal, timeoutMs: config.image_backends.openai.timeout_ms })

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
