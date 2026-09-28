import type { ConversationMessage, TextAIProvider } from './types'
import { log, serializeError } from '../logger'
import { truncate } from '../../shared/textCleanup'
import { abortableDelay } from '../utils/abortable-delay'
import { provedNotProcessed } from '../provider-errors'

const REJECTED_PAYLOAD_PREVIEW_GRAPHEMES = 200

/** Which boundary a retry belongs to, for useful diagnostics. */
export type JsonCallLabel = 'aspects' | 'domains' | 'clusters' | 'prose'

/**
 * One schema-forced provider call the user waits on, with bounded, abort-aware
 * retries. Validation is supplied by the caller so this helper stays free of
 * concepts and prompt prose. Only a failure that proves the provider did no work
 * is sent again; any other outcome, including a timeout, a 5xx and a reply with no
 * usable payload, may have been billed and is reported for the user to retry.
 */
export async function askJsonWithRetry<T>(options: {
  provider: TextAIProvider
  messages: ConversationMessage[]
  schema: object
  timeoutMs: number
  validate: (parsed: unknown, rawText: string) => T | null
  maxRetries: number
  backoffSchedule: number[]
  signal: AbortSignal
  label: JsonCallLabel
  requestId: string
}): Promise<T> {
  const {
    provider, messages, schema, timeoutMs, validate, maxRetries,
    backoffSchedule, signal, label, requestId,
  } = options
  let lastError: unknown = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal.aborted) break
    if (attempt > 0) {
      const backoff = backoffSchedule.length > 0
        ? backoffSchedule[Math.min(attempt - 1, backoffSchedule.length - 1)]
        : 1000
      log('warn', 'Brainstorm call failed, retrying', {
        requestId, call: label, attempt, backoff,
        error: serializeError(lastError),
      })
      await abortableDelay(backoff, signal)
      if (signal.aborted) break
    }

    try {
      const result = await provider.ask({
        messages,
        schema,
        timeoutMs,
        signal,
      })
      const value = validate(result.parsed, result.text)
      if (value === null) {
        const preview = truncate(result.text ?? '', REJECTED_PAYLOAD_PREVIEW_GRAPHEMES)
        log('warn', 'Brainstorm call returned no usable payload', {
          requestId,
          call: label,
          attempt,
          replyChars: (result.text ?? '').length,
          replyPreview: preview.text,
          previewTruncated: preview.truncated,
        })
        throw new Error('Text AI returned no usable payload.')
      }
      return value
    } catch (err) {
      // Anything that may have been processed is the user's to resend, not ours.
      if (!provedNotProcessed(err)) throw err
      lastError = err
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Cancelled.'))
}
