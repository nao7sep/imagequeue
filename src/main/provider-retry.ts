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

// Only answers proving no processing are resent; SDKs perform exactly one
// attempt. `maxAttempts` is the caller's own cap; a caller with none gets three
// attempts. `timeoutMs`, when given, bounds all attempts together; a caller
// without it leaves each attempt to the call's own timeout.
export async function withProviderRetry<T>(call: (signal: AbortSignal) => Promise<T>, options: {
  signal: AbortSignal
  maxAttempts?: number
  backoff?: readonly number[]
  timeoutMs?: number
  onRetry?: (error: unknown, attempt: number, backoffMs: number) => void
}): Promise<T> {
  const { backoff = [1000, 2000] } = options
  const timeout = options.timeoutMs === undefined ? undefined : AbortSignal.timeout(options.timeoutMs)
  const signal = timeout ? AbortSignal.any([options.signal, timeout]) : options.signal
  const attempts = Math.max(1, options.maxAttempts ?? 3)
  try {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted()
      try { return await call(signal) } catch (error) {
        if (signal.aborted || attempt + 1 >= attempts || !provedNotProcessed(error)) throw error
        const backoffMs = retryDelayMs(error, backoff[Math.min(attempt, backoff.length - 1)] ?? 1000)
        options.onRetry?.(error, attempt + 1, backoffMs)
        await abortableDelay(backoffMs, signal)
      }
    }
  } catch (error) {
    if (timeout?.aborted && !options.signal.aborted) throw new ProviderTimeoutError('Provider', options.timeoutMs!)
    throw error
  }
}
