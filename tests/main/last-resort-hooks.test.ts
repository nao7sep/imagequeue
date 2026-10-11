import { afterEach, expect, it, vi } from 'vitest'
import { installLastResortHooks } from '../../src/main/last-resort-hooks'
import { startAiCall } from '../../src/main/records'

const exit = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ app: { exit } }))

afterEach(() => { vi.restoreAllMocks(); exit.mockClear() })

function captureHooks() {
  const listeners = new Map<string, (error: unknown) => void>()
  vi.spyOn(process, 'on').mockImplementation(((name: string, listener: (error: unknown) => void) => {
    listeners.set(name, listener)
    return process
  }) as typeof process.on)
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  installLastResortHooks()
  return { listeners, consoleError }
}

it.each(['uncaughtException', 'unhandledRejection'])('masks captured credentials in every %s sink without changing the error or exit policy', (event) => {
  const secret = 'credential-from-an-earlier-request'
  startAiCall({ backend: 'openai', model: 'gpt-image-2', purpose: 'image', credentials: [secret], request: {} })
  const { listeners, consoleError } = captureHooks()
  const error = Object.assign(new Error(`Provider echoed ${secret}`, { cause: new Error(`cause ${secret}`) }), {
    code: 'DIAGNOSTIC_CODE', path: '/diagnostic/path', headers: { Authorization: `Bearer ${secret}` },
    download: 'https://example.test/image?sig=SIGNED_DOWNLOAD_SECRET&other=retained',
  })
  listeners.get(event)!(error)

  expect(consoleError).toHaveBeenCalled()
  const sinks = JSON.stringify(consoleError.mock.calls)
  expect(sinks).not.toContain(secret)
  expect(sinks).not.toContain('SIGNED_DOWNLOAD_SECRET')
  expect(sinks).toContain('[REDACTED]')
  expect(sinks).toContain('DIAGNOSTIC_CODE')
  expect(sinks).toContain('/diagnostic/path')
  expect(sinks).toContain('cause')
  expect(consoleError.mock.calls.at(-1)?.[1]).toMatchObject({
    name: 'Error', message: 'Provider echoed [REDACTED]', code: 'DIAGNOSTIC_CODE',
    headers: { Authorization: 'Bearer [REDACTED]' }, cause: { message: 'cause [REDACTED]' },
  })
  expect(error.message).toContain(secret)
  expect(error.cause).toMatchObject({ message: `cause ${secret}` })
  expect(error.headers.Authorization).toBe(`Bearer ${secret}`)
  if (event === 'uncaughtException') expect(exit).toHaveBeenCalledExactlyOnceWith(1)
  else expect(exit).not.toHaveBeenCalled()
})

it.each(['uncaughtException', 'unhandledRejection'])('retains %s policy and useful masked fields when a diagnostic contains cycles', (event) => {
  const secret = 'credential-echoed-in-a-cyclic-error'
  startAiCall({ backend: 'openai', model: 'gpt-image-2', purpose: 'image', credentials: [secret], request: {} })
  const { listeners, consoleError } = captureHooks()
  const shared = { detail: 'still useful', credential: secret }
  const request: Record<string, unknown> = { url: '/provider/request', first: shared, second: shared }
  request.self = request
  const items: unknown[] = [secret]
  items.push(items)
  request.items = items
  const reason = event === 'uncaughtException'
    ? Object.assign(new Error(`echo ${secret}`), { request })
    : { code: 'PROVIDER_REJECTION', request }

  expect(() => listeners.get(event)!(reason)).not.toThrow()
  const sinks = JSON.stringify(consoleError.mock.calls)
  expect(sinks).not.toContain(secret)
  expect(sinks).toContain('[REDACTED]')
  expect(sinks).toContain('[Circular]')
  const diagnostic = consoleError.mock.calls.at(-1)?.[1] as { request?: unknown; value?: { request?: unknown } }
  expect(diagnostic.request ?? diagnostic.value?.request).toMatchObject({
    url: '/provider/request', first: { detail: 'still useful', credential: '[REDACTED]' },
    second: { detail: 'still useful', credential: '[REDACTED]' }, self: '[Circular]',
    items: ['[REDACTED]', '[Circular]'],
  })
  expect(request.self).toBe(request)
  expect(items[1]).toBe(items)
  expect(shared.credential).toBe(secret)
  if (event === 'uncaughtException') expect(exit).toHaveBeenCalledExactlyOnceWith(1)
  else expect(exit).not.toHaveBeenCalled()
})
