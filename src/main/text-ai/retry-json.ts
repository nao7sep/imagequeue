import type { ConversationMessage, TextAIProvider } from './types'
import { log, serializeError } from '../logger'
import { withProviderRetry } from '../provider-retry'

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
  signal: AbortSignal
  label: JsonCallLabel
  requestId: string
}): Promise<T> {
  const {
    provider, messages, schema, timeoutMs, validate, signal, label, requestId,
  } = options
  return withProviderRetry(async (attemptSignal) => {
    const result = await provider.ask({ messages, schema, timeoutMs, signal: attemptSignal, record: { purpose: label, requestId } })
    const value = validate(result.parsed, result.text)
    if (value === null) {
      // The whole reply is already in this call's AI-call record (same
      // requestId); the warning points at it rather than keeping a cut copy
      // (text-cleanup-conventions: truncation is display-only).
      log('warn', 'Brainstorm call returned no usable payload', {
        requestId,
        call: label,
        replyChars: (result.text ?? '').length,
      })
      throw new Error('Text AI returned no usable payload.')
    }
    return value
  }, {
    signal,
    onRetry: (error, attempt, backoff) => log('warn', 'Brainstorm call failed, retrying', {
      requestId, call: label, attempt, backoff, error: serializeError(error),
    }),
  })
}
