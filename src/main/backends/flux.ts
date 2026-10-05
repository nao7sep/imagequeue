import { Task } from '../../shared/types'
import { loadConfig } from '../config'
import { withProviderRetry } from '../provider-retry'
import { resolveApiKey } from '../config/api-keys-store'
import { log } from '../logger'
import { fetchRecorded } from '../records'
import { CANCELLED_MESSAGE } from './cancellation'
import { abortableDelay } from '../utils/abortable-delay'
import { MissingApiKeyError, provedNotStarted, ProviderHttpError, ProviderStatusError, ProviderTimeoutError } from '../provider-errors'
import { fluxReasonField, reasonFromBody } from '../provider-reason'
import { buildFluxBody } from './flux-request'

const BASE_URL = 'https://api.bfl.ai/v1'
const POLL_INTERVAL_MS = 2000
// BFL's final words for a job that made no image. Any other status is a job
// still at work — FLUX 3 passes through Reasoning and Generating, words FLUX.2
// never used — so an unknown one is polled on, within the request's timeout,
// rather than abandoning a paid job.
const ENDED_WITHOUT_IMAGE = new Set(['Request Moderated', 'Content Moderated', 'Task not found', 'Error', 'Failed'])

// Calls FLUX API (async submit/poll/download flow) and returns the image bytes,
// the Content-Type reported by the signed-URL download, and the seed it sent.
export async function generateFlux(task: Task, signal: AbortSignal): Promise<{ buffer: Buffer; mimeType?: string; seed?: number }> {
  const config = loadConfig()
  const apiKey = resolveApiKey('bfl')

  if (!apiKey) {
    throw new MissingApiKeyError('FLUX')
  }

  const body = buildFluxBody(task)

  const startTime = Date.now()

  // A signal that is ALREADY aborted never fires its listener — today no await
  // sits between registration and this point, but that is one refactor from
  // silently ignoring a stop. The guard makes the contract explicit.
  if (signal.aborted) throw new Error(CANCELLED_MESSAGE)

  const { timeout_ms } = config.image_backends.flux
  // One controller, two reasons to fire: the request's own timeout and the
  // queue asking to stop. Aborting it also breaks the polling loop, which would
  // otherwise keep asking for a result nobody is waiting for.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout_ms)
  const onAbort = (): void => controller.abort()
  signal.addEventListener('abort', onAbort, { once: true })

  try {
    const call = { backend: 'flux', model: task.model, purpose: 'image', taskId: task.id }
    const submitUrl = `${BASE_URL}/${task.model}`
    const submitHeaders = { 'Content-Type': 'application/json', 'x-key': apiKey }
    const submitData = await withProviderRetry(async (attemptSignal) => {
      const { response: submitResponse, text } = await fetchRecorded(
        { ...call, request: { url: submitUrl, headers: submitHeaders, body } },
        submitUrl,
        { method: 'POST', headers: submitHeaders, body: JSON.stringify(body), signal: attemptSignal },
      )

      if (!submitResponse.ok) {
        log('error', 'FLUX submit request failed', { model: task.model, status: submitResponse.status, body: text })
        throw new ProviderHttpError(`FLUX submit failed (${submitResponse.status}): ${text}`, submitResponse.status, reasonFromBody(text, fluxReasonField), submitResponse.headers.get('retry-after'))
      }

      return JSON.parse(text) as { id: string; polling_url?: string }
    // The submit is the paid request; a poll below costs nothing and keeps the ordinary proof.
    }, { signal: controller.signal, resend: provedNotStarted })
    const pollingUrl = submitData.polling_url || `${BASE_URL}/get_result?id=${submitData.id}`

    // Poll for result
    while (true) {
      await abortableDelay(POLL_INTERVAL_MS, controller.signal)

      const pollHeaders = { 'x-key': apiKey }
      const pollData = await withProviderRetry(async (attemptSignal) => {
        const { response: pollResponse, text } = await fetchRecorded(
          { ...call, request: { url: pollingUrl, headers: pollHeaders } },
          pollingUrl,
          { headers: pollHeaders, signal: attemptSignal },
        )

        if (!pollResponse.ok) {
          log('error', 'FLUX poll request failed', { model: task.model, status: pollResponse.status, jobId: submitData.id })
          throw new ProviderHttpError(`FLUX poll failed (${pollResponse.status})`, pollResponse.status, reasonFromBody(text, fluxReasonField), pollResponse.headers.get('retry-after'))
        }

        return JSON.parse(text) as {
          status: string
          result?: { sample?: string }
        }
      }, { signal: controller.signal })

      if (pollData.status === 'Ready') {
        const imageUrl = pollData.result?.sample
        if (!imageUrl) {
          log('error', 'FLUX completed but response missing image URL', { model: task.model, result: pollData.result })
          throw new Error('FLUX completed but no image URL in response')
        }

        // Download image from signed URL
        const imageResponse = await fetch(imageUrl, { signal: controller.signal })
        if (!imageResponse.ok) {
          log('error', 'FLUX image download failed', { model: task.model, status: imageResponse.status })
          // A plain Error, not ProviderHttpError: this status is the signed download
          // URL's, not an answer about the user's key or rate limit.
          throw new Error(`Failed to download FLUX image (${imageResponse.status})`)
        }

        return {
          buffer: Buffer.from(await imageResponse.arrayBuffer()),
          mimeType: imageResponse.headers.get('content-type') ?? undefined,
          ...(typeof body.seed === 'number' ? { seed: body.seed } : {}),
        }
      }

      if (!ENDED_WITHOUT_IMAGE.has(pollData.status)) continue

      // Polling on after a final word would only turn it into a timeout the
      // provider never had.
      log('error', 'FLUX generation ended without an image', { model: task.model, status: pollData.status, jobId: submitData.id })
      throw new ProviderStatusError('FLUX', String(pollData.status))
    }
  } catch (err) {
    // The queue's signal and the timeout share one controller, so the abort
    // alone cannot say which fired; `signal.aborted` can.
    if (signal.aborted) throw new Error(CANCELLED_MESSAGE)
    if (err instanceof Error && err.name === 'AbortError') {
      log('error', 'FLUX generation timed out', { model: task.model, timeoutMs: timeout_ms, elapsedMs: Date.now() - startTime })
      throw new ProviderTimeoutError('FLUX generation', timeout_ms)
    }
    throw err
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}
