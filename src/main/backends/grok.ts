import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { withProviderRetry } from '../provider-retry'
import { resolveApiKey } from '../config/api-keys-store'
import { log, serializeError } from '../logger'
import { fetchRecorded } from '../records'
import { CANCELLED_MESSAGE } from './cancellation'
import { MissingApiKeyError, ProviderHttpError, ProviderTimeoutError } from '../provider-errors'
import { grokReasonField, reasonFromBody } from '../provider-reason'

const BASE_URL = 'https://api.x.ai/v1'

// Calls the xAI Grok Imagine image generation API and returns the image bytes
// with an `image/jpeg` MIME hint. The API always returns JPEG — no format
// selection is available.
export async function generateGrok(task: Task, signal: AbortSignal): Promise<{ buffer: Buffer; mimeType?: string }> {
  const config = loadConfig()
  const apiKey = resolveApiKey('xai')

  if (!apiKey) {
    throw new MissingApiKeyError('Grok Imagine')
  }

  // A signal that is ALREADY aborted never fires its listener — today no await
  // sits between registration and this point, but that is one refactor from
  // silently ignoring a stop. The guard makes the contract explicit.
  if (signal.aborted) throw new Error(CANCELLED_MESSAGE)

  const { timeout_ms } = config.image_backends.grok
  // One controller, two reasons to fire: the request's own timeout and the
  // queue asking to stop. Which one fired is read back off `signal` below, so a
  // stop is never logged or recorded as a timeout.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout_ms)
  const onAbort = (): void => controller.abort()
  signal.addEventListener('abort', onAbort, { once: true })

  const params = task.params as { aspectRatio?: string; resolution?: string; quality?: string }

  const body: Record<string, unknown> = {
    model: task.model,
    prompt: task.prompt,
    n: 1,
    response_format: 'b64_json'
  }

  if (params.aspectRatio) body.aspect_ratio = params.aspectRatio
  if (params.resolution) body.resolution = params.resolution
  if (params.quality) body.quality = params.quality

  const url = `${BASE_URL}/images/generations`
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  }

  try {
    const json = await withProviderRetry(async (attemptSignal) => {
      const { response, text } = await fetchRecorded(
        { backend: 'grok', model: task.model, purpose: 'image', taskId: task.id, request: { url, headers, body } },
        url,
        { method: 'POST', headers, body: JSON.stringify(body), signal: attemptSignal },
        // The image bytes are the saved file's.
        (parsed) => {
          const answer = parsed as { data?: { b64_json?: string }[] }
          return { ...answer, data: answer.data?.map(({ b64_json: _bytes, ...rest }) => rest) }
        },
      )

      if (!response.ok) {
        log('error', 'Grok Imagine API error response', { status: response.status, body: text })
        throw new ProviderHttpError(`Grok API error ${response.status}: ${text.slice(0, 200)}`, response.status, reasonFromBody(text, grokReasonField), response.headers.get('retry-after'))
      }

      return JSON.parse(text) as { data: { b64_json?: string }[] }
    }, { signal: controller.signal })

    const b64 = json.data?.[0]?.b64_json

    if (!b64) {
      log('error', 'Grok Imagine response missing image data', { model: task.model })
      throw new Error('No image data in Grok Imagine response')
    }

    return { buffer: Buffer.from(b64, 'base64'), mimeType: 'image/jpeg' }
  } catch (err) {
    // The queue's signal and the timeout share one controller, so the abort
    // alone cannot say which fired; `signal.aborted` can.
    if (signal.aborted) throw new Error(CANCELLED_MESSAGE)
    if (err instanceof Error && err.name === 'AbortError') {
      log('error', 'Grok Imagine timed out', { model: task.model, timeoutMs: timeout_ms })
      throw new ProviderTimeoutError('Grok API', timeout_ms)
    }
    if (!(err instanceof ProviderHttpError)) {
      log('error', 'Grok Imagine API call failed', {
        model: task.model,
        error: serializeError(err)
      })
    }
    throw err
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}
