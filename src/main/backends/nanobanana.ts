import { ApiError, GoogleGenAI, type GenerateContentResponse } from '@google/genai'
import { withProviderRetry } from '../provider-retry'
import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { resolveApiKey } from '../config/api-keys-store'
import { log, serializeError } from '../logger'
import { recordAiCall } from '../records'
import { buildGeminiImageRequest } from './nanobanana-request'
import { assertUsableGeminiResponse } from '../provider-response'
import { CANCELLED_MESSAGE } from './cancellation'
import { MissingApiKeyError, ProviderHttpError, ProviderTimeoutError } from '../provider-errors'
import { geminiReasonField, reasonFromBody } from '../provider-reason'

// Calls the Gemini native image generation API (generateContent) and returns
// the first image part as a Buffer along with its MIME-type hint. The Gemini
// API may return either PNG or JPEG bytes; callers should rely on the hint
// (and magic-byte detection) rather than assuming a fixed format.
// Uses the 'gemini.nanobanana' secret (its own key, not the Gemini text key).
export async function generateNanoBanana(task: Task, signal: AbortSignal): Promise<{ buffer: Buffer; mimeType?: string }> {
  const config = loadConfig()
  const apiKey = resolveApiKey('gemini.nanobanana')

  if (!apiKey) {
    throw new MissingApiKeyError('Nano Banana')
  }

  // The app owns retries; the SDK performs exactly one attempt.
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: config.image_backends.nanobanana.timeout_ms, retryOptions: { attempts: 1 } } })

  const request = buildGeminiImageRequest(task)

  // The record keeps the request body the app built, not the HTTP request:
  // @google/genai takes no fetch or request hook to capture what it sends.
  const response = await withProviderRetry((attemptSignal) => recordAiCall(
    { backend: 'nanobanana', model: task.model, purpose: 'image', taskId: task.id, request },
    // No cast: GenerateContentConfig declares every field here, so the
    // compiler proves the abort signal reaches this backend. Aborting is
    // client-side only, per the SDK: it stops us waiting, it does not stop the
    // service, and the call is still billed.
    () => ai.models.generateContent({ ...request, config: { ...request.config, abortSignal: attemptSignal } }),
    withoutImageBytes,
  ).catch((err: unknown) => {
    if (err instanceof ApiError) {
      const said = reasonFromBody(err.message, geminiReasonField)
      throw new ProviderHttpError(said ?? `Gemini API error ${err.status}`, err.status, said)
    }
    throw err
  }), { signal, timeoutMs: config.image_backends.nanobanana.timeout_ms }).catch((err: unknown) => {
    if (signal.aborted) throw new Error(CANCELLED_MESSAGE)
    if (err instanceof Error && err.name === 'AbortError') {
      log('error', 'Nano Banana API timed out', { model: task.model, timeoutMs: config.image_backends.nanobanana.timeout_ms })
      throw new ProviderTimeoutError('Nano Banana API', config.image_backends.nanobanana.timeout_ms)
    }
    log('error', 'Nano Banana API call failed', {
      model: task.model,
      requestParams: request.config,
      status: (err as Record<string, unknown>).status ?? (err as Record<string, unknown>).httpStatus,
      error: serializeError(err)
    })
    throw err
  })

  assertUsableGeminiResponse(response, 'image')

  const parts = response.candidates?.[0]?.content?.parts ?? []
  const imagePart = parts.find((p) => p.inlineData?.data)

  if (!imagePart?.inlineData?.data) {
    log('error', 'Nano Banana response missing image data', {
      model: task.model,
      candidateCount: response.candidates?.length ?? 0,
      partCount: parts.length
    })
    throw new Error('No image data in Nano Banana response')
  }

  return {
    buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
    mimeType: imagePart.inlineData.mimeType
  }
}

// The response as recorded: the image bytes are the saved file's.
function withoutImageBytes(response: GenerateContentResponse): unknown {
  const copy = JSON.parse(JSON.stringify(response)) as GenerateContentResponse
  for (const candidate of copy.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData) delete part.inlineData.data
    }
  }
  return copy
}
