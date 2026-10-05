import { describe, expect, it, vi } from 'vitest'
import { withProviderRetry, retryDelayMs } from '../../src/main/provider-retry'
import { ProviderHttpError, ProviderTimeoutError } from '../../src/main/provider-errors'

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
  // The fleet rule, the same for an image as for text: a refused or unresolved
  // connection, 408, 429 and 503 are resent within the cap.
  it.each([408, 429, 503])('resends after a %i', async (status) => {
    const error = new ProviderHttpError('busy', status)
    const call = vi.fn(async () => { throw error })
    await expect(withProviderRetry(call, { signal: signal() })).rejects.toBe(error)
    expect(call).toHaveBeenCalledTimes(3)
  })
  it.each(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'])('resends after a connection that never opened (%s)', async (code) => {
    const error = Object.assign(new Error('no connection'), { code })
    const call = vi.fn(async () => { throw error })
    await expect(withProviderRetry(call, { signal: signal() })).rejects.toBe(error)
    expect(call).toHaveBeenCalledTimes(3)
  })
  // These may follow processing, so they are reported, never resent.
  it.each([
    ['a 500', new ProviderHttpError('server', 500)],
    ['a 502', new ProviderHttpError('gateway', 502)],
    ['a 504', new ProviderHttpError('gateway timeout', 504)],
    ['a timeout', new ProviderTimeoutError('Provider', 1000)],
    ['a dropped connection', Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })],
    ['a refusal', new ProviderHttpError('bad request', 400)],
  ])('does not resend after %s', async (_name, error) => {
    const call = vi.fn(async () => { throw error })
    await expect(withProviderRetry(call, { signal: signal() })).rejects.toBe(error)
    expect(call).toHaveBeenCalledOnce()
  })
  it('does not resend when its own time limit runs out', async () => {
    const call = vi.fn((attemptSignal: AbortSignal) => new Promise<never>((_resolve, reject) => {
      attemptSignal.addEventListener('abort', () => reject(attemptSignal.reason), { once: true })
    }))
    await expect(withProviderRetry(call, { signal: signal(), timeoutMs: 10 })).rejects.toBeInstanceOf(ProviderTimeoutError)
    expect(call).toHaveBeenCalledOnce()
  })
})
