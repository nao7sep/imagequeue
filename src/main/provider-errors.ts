/**
 * The kinds of provider failure the app acts on differently, each carried as a type rather
 * than as message text. The backend that sees the failure is the one place that classifies
 * it; presentation (what the task row says) and retry policy (whether a text call is sent
 * again) read the type and never parse a message.
 *
 * Anything not listed here is an unclassified failure: it is shown as a generic failure and,
 * in elaboration, reported to the user, who decides whether to send it again.
 */

/** No API key is stored for the backend a task was queued on. */
export class MissingApiKeyError extends Error {
  constructor(provider: string) {
    super(`${provider} API key not configured`)
    this.name = 'MissingApiKeyError'
  }
}

/** The provider answered with an HTTP error status. `status` is the same field the SDKs'
 *  own errors carry, so SDK and fetch failures are classified alike. `providerMessage` is
 *  the provider's human-readable reason (see providerMessage below). */
export class ProviderHttpError extends Error {
  constructor(message: string, readonly status: number, readonly providerMessage: string | null = null, readonly retryAfter: string | null = null) {
    super(message)
    this.name = 'ProviderHttpError'
  }
}

/** The request's own time limit ran out; a user's Stop is a cancellation, never this. */
export class ProviderTimeoutError extends Error {
  constructor(provider: string, timeoutMs: number) {
    super(`${provider} timed out after ${Math.round(timeoutMs / 1000)}s`)
    this.name = 'TimeoutError'
  }
}

/** The provider refused the input — a block reason, a refusal string, a content filter or a
 *  moderation block. Sending the same input again gets the same refusal. `reason` is the
 *  provider's own short code or statement; `providerMessage` is its human-readable
 *  explanation, when it gave one. */
export class ProviderRefusalError extends Error {
  constructor(message: string, readonly reason: string, readonly providerMessage: string | null = null) {
    super(message)
    this.name = 'ProviderRefusalError'
  }
}

/** The reply stopped at the provider's output limit, so it is cut short rather than complete. */
export class ProviderTruncationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderTruncationError'
  }
}

/** A provider ended a request with its own terminal status — FLUX's "Request Moderated", for
 *  one, or a Gemini finish reason. The status is the provider's stated outcome, kept
 *  structured so presentation can name it instead of reporting a timeout the provider never had. */
export class ProviderStatusError extends Error {
  constructor(provider: string, readonly providerStatus: string, message?: string) {
    super(message ?? `${provider} ended the request with status "${providerStatus}"`)
    this.name = 'ProviderStatusError'
  }
}

/** Whether a failure proves the provider did no work on the request, so sending it again cannot
 *  charge twice: the provider answered 408, 429 or 503, or the connection was refused or
 *  never resolved. A timeout, a dropped connection, a 5xx from a gateway, an unusable reply
 *  and every settled answer (a refusal, a truncation, a terminal status, a missing key, any
 *  other 4xx) may follow processing or repeat exactly, so elaboration the user waits on
 *  reports them and the user decides whether to resend. */
export function provedNotProcessed(error: unknown): boolean {
  const status = httpStatus(error)
  if (status !== null) return status === 408 || status === 429 || status === 503
  for (let e: unknown = error, depth = 0; e && typeof e === 'object' && depth < 5; depth++) {
    const code = (e as { code?: unknown }).code
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') return true
    e = (e as { cause?: unknown }).cause
  }
  return false
}

/** The provider's human-readable reason for a failure — the message field of its error
 *  body, as the provider wrote it (see provider-reason) — or null when the failure is not a
 *  provider answer or the provider gave no reason. The backend that received the answer
 *  records it on the classified error; this never parses an SDK or transport message. */
export function providerMessage(error: unknown): string | null {
  if (error instanceof ProviderRefusalError || error instanceof ProviderHttpError) {
    return error.providerMessage
  }
  return null
}

/** The HTTP status an error carries, whether it came from fetch or a provider SDK. */
export function httpStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const record = error as Record<string, unknown>
  const value = record.status ?? record.statusCode
  return typeof value === 'number' ? value : null
}
