import { provedNotProcessed, ProviderHttpError, ProviderTimeoutError } from './provider-errors'
import { abortableDelay } from './utils/abortable-delay'

function retryAfter(error: unknown): string | null {
  if (error instanceof ProviderHttpError) return error.retryAfter
  if (!error || typeof error !== 'object' || !('headers' in error)) return null
  const headers = error.headers
  if (headers instanceof Headers) return headers.get('retry-after')
  if (headers && typeof headers === 'object' && 'retry-after' in headers) {
    return typeof headers['retry-after'] === 'string' ? headers['retry-after'] : null
  }
  return null
}

export function retryDelayMs(error: unknown, backoff: number, now = Date.now()): number {
  const value = retryAfter(error)
  if (value !== null) {
    const seconds = Number(value)
    const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now
    if (Number.isFinite(milliseconds)) return Math.min(30000, Math.max(0, milliseconds))
  }
  return Math.max(0, backoff)
}

// The attempt cap and backoff are constants, not settings
// (ai-model-routing-conventions), the same for every provider call.
export const PROVIDER_MAX_ATTEMPTS = 3
export const PROVIDER_RETRY_BACKOFF_MS: readonly number[] = [1000, 2000]

// Only answers proving no processing are resent; SDKs perform exactly one
// attempt. `timeoutMs`, when given, bounds all attempts together; a caller
// without it leaves each attempt to the call's own timeout.
export async function withProviderRetry<T>(call: (signal: AbortSignal) => Promise<T>, options: {
  signal: AbortSignal
  timeoutMs?: number
  onRetry?: (error: unknown, attempt: number, backoffMs: number) => void
}): Promise<T> {
  const timeout = options.timeoutMs === undefined ? undefined : AbortSignal.timeout(options.timeoutMs)
  const signal = timeout ? AbortSignal.any([options.signal, timeout]) : options.signal
  try {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted()
      try { return await call(signal) } catch (error) {
        if (signal.aborted || attempt + 1 >= PROVIDER_MAX_ATTEMPTS || !provedNotProcessed(error)) throw error
        const backoffMs = retryDelayMs(error, PROVIDER_RETRY_BACKOFF_MS[Math.min(attempt, PROVIDER_RETRY_BACKOFF_MS.length - 1)]!)
        options.onRetry?.(error, attempt + 1, backoffMs)
        await abortableDelay(backoffMs, signal)
      }
    }
  } catch (error) {
    if (timeout?.aborted && !options.signal.aborted) throw new ProviderTimeoutError('Provider', options.timeoutMs!)
    throw error
  }
}
