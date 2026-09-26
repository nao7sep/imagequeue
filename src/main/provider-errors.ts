/**
 * The kinds of provider failure the app acts on differently, each carried as a type rather
 * than as message text. The backend that sees the failure is the one place that classifies
 * it; presentation (what the task row says) and retry policy (whether a text call is sent
 * again) read the type and never parse a message.
 *
 * Anything not listed here is an unclassified failure: it is shown as a generic failure and,
 * in elaboration, retried as possibly transient.
 */

/** No API key is stored for the backend a task was queued on. */
export class MissingApiKeyError extends Error {
  constructor(provider: string) {
    super(`${provider} API key not configured`)
    this.name = 'MissingApiKeyError'
  }
}

/** The provider answered with an HTTP error status. `status` is the same field the SDKs'
 *  own errors carry, so SDK and fetch failures are classified alike. */
export class ProviderHttpError extends Error {
  constructor(message: string, readonly status: number) {
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
 *  provider's own short code or statement. */
export class ProviderRefusalError extends Error {
  constructor(message: string, readonly reason: string) {
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

/** Whether sending the same request again could produce a different outcome. A refusal, a
 *  truncation, a terminal status, a missing key and a 4xx other than 408/429 are the
 *  provider's settled answer to this input; everything else (network, timeout, 5xx, 429,
 *  an unusable payload) may pass on another attempt. */
export function isRetryableProviderFailure(error: unknown): boolean {
  if (
    error instanceof ProviderRefusalError ||
    error instanceof ProviderTruncationError ||
    error instanceof ProviderStatusError ||
    error instanceof MissingApiKeyError
  ) return false
  const status = httpStatus(error)
  if (status !== null && status >= 400 && status < 500) return status === 408 || status === 429
  return true
}

/** The HTTP status an error carries, whether it came from fetch or a provider SDK. */
export function httpStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const record = error as Record<string, unknown>
  const value = record.status ?? record.statusCode
  return typeof value === 'number' ? value : null
}
