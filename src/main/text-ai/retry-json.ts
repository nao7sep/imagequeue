import type { ConversationMessage, TextAIProvider } from './types'
import { log, serializeError } from '../logger'
import { truncate } from '../../shared/textCleanup'
import { abortableDelay } from '../utils/abortable-delay'

const REJECTED_PAYLOAD_PREVIEW_GRAPHEMES = 200
const STRICT_JSON_NUDGE = 'Reply with valid JSON only — no prose, no markdown fences.'

/** Which boundary a retry belongs to, for useful diagnostics. */
export type JsonCallLabel = 'aspects' | 'domains' | 'clusters' | 'prose'

/**
 * One schema-forced provider call with bounded, abort-aware retries.
 * Validation is supplied by the caller so transport and payload failures share
 * one retry policy without coupling this helper to concepts or prompt prose.
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
      const effectiveMessages = attempt === 0
        ? messages
        : messages.map((message, index) =>
            index === messages.length - 1 && message.role === 'user'
              ? { ...message, text: `${STRICT_JSON_NUDGE}\n\n${message.text}` }
              : message
          )
      const result = await provider.ask({
        messages: effectiveMessages,
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
      lastError = err
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Cancelled.'))
}
