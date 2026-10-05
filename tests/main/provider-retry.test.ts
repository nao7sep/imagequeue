import { describe, expect, it, vi } from 'vitest'
import { withProviderRetry, retryDelayMs } from '../../src/main/provider-retry'
import { ProviderHttpError, provedNotStarted } from '../../src/main/provider-errors'

const delay = vi.hoisted(() => vi.fn(async (_ms: number, _signal: AbortSignal) => undefined))
vi.mock('../../src/main/utils/abortable-delay', () => ({ abortableDelay: delay }))
const signal = () => new AbortController().signal

describe('provider retry boundary', () => {
  it('makes three attempts for a caller with no cap of its own', async () => {
    const error = new ProviderHttpError('busy', 503, 'busy', '60')
    const call = vi.fn(async () => { throw error })
    await expect(withProviderRetry(call, { signal: signal() })).rejects.toBe(error)
    expect(call).toHaveBeenCalledTimes(3)
    expect(delay.mock.calls.slice(-2).map((args) => args[0])).toEqual([30000, 30000])
  })
  it('honours the caller\'s own cap above three', async () => {
    const error = new ProviderHttpError('busy', 503)
    const call = vi.fn(async () => { throw error })
    await expect(withProviderRetry(call, { signal: signal(), maxAttempts: 6 })).rejects.toBe(error)
    expect(call).toHaveBeenCalledTimes(6)
  })
  it('honors seconds and HTTP-date Retry-After, capped at 30 seconds', () => {
    expect(retryDelayMs(new ProviderHttpError('busy', 429, null, '2'), 1000)).toBe(2000)
    expect(retryDelayMs(new ProviderHttpError('busy', 429, null, 'Thu, 01 Oct 2026 00:00:20 GMT'), 1000, Date.parse('2026-10-01T00:00:00Z'))).toBe(20000)
    expect(retryDelayMs(new ProviderHttpError('busy', 429, null, 'invalid'), 1500)).toBe(1500)
  })
  it('stops when cancellation lands during backoff', async () => {
    const controller = new AbortController()
    const error = new ProviderHttpError('busy', 503)
    const call = vi.fn(async () => { controller.abort(); throw error })
    await expect(withProviderRetry(call, { signal: controller.signal })).rejects.toBe(error)
    expect(call).toHaveBeenCalledOnce()
  })
  // A proxy can answer 408 or 503 after the provider made (and billed) the image,
  // so an image request is resent only on a 429 or a connection that never opened.
  it.each([408, 503])('does not resend an image request after a %i', async (status) => {
    const error = new ProviderHttpError('busy', status)
    const call = vi.fn(async () => { throw error })
    await expect(withProviderRetry(call, { signal: signal(), resend: provedNotStarted })).rejects.toBe(error)
    expect(call).toHaveBeenCalledOnce()
  })
  it('resends an image request after a 429 or a refused connection', async () => {
    for (const error of [new ProviderHttpError('slow down', 429), Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })]) {
      const call = vi.fn(async () => { throw error })
      await expect(withProviderRetry(call, { signal: signal(), resend: provedNotStarted })).rejects.toBe(error)
      expect(call).toHaveBeenCalledTimes(3)
    }
  })
})
