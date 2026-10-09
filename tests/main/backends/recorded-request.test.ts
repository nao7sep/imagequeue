import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../../../src/shared/types'
import { columnParams } from './column-params'
import { freshRecordsRoot, readRows, removeRecordsRoots } from '../records-fixture'

// The FLUX and Grok backends record the request they send, its headers
// included, but never the key those headers carry, and FLUX's signed result URL
// is recorded without its signature. The request sent keeps the key.

vi.mock('../../../src/main/config', () => ({
  loadConfig: () => ({ image_backends: { flux: { timeout_ms: 180000 }, grok: { timeout_ms: 180000 } } }),
}))
vi.mock('../../../src/main/config/api-keys-store', () => ({ resolveApiKey: () => 'test-key' }))
vi.mock('../../../src/main/logger', () => ({ log: vi.fn(), serializeError: (error: unknown) => error }))
vi.mock('../../../src/main/utils/abortable-delay', () => ({ abortableDelay: async () => undefined }))

const { generateFlux } = await import('../../../src/main/backends/flux')
const { generateGrok } = await import('../../../src/main/backends/grok')

const task = (backend: 'flux' | 'grok', model: string): Task => ({
  id: 't1', prompt: 'a fox', backend, model, params: columnParams(backend, model),
  status: 'generating', enqueuedAt: '2026-01-01T00:00:00.000Z', startedAt: null,
  completedAt: null, durationMs: null, imagePath: null, baseName: null, error: null, providerMessage: null,
})

function calls(dir: string): { request: Record<string, unknown>; response: Record<string, unknown>; raw: string }[] {
  return readRows(dir, 'ai_calls').map((row) => ({
    request: JSON.parse(row.request as string),
    response: JSON.parse(row.response as string),
    raw: `${row.request as string}${row.response as string}`,
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})
afterAll(() => {
  removeRecordsRoots()
})

describe('recorded image requests', () => {
  it('keep FLUX\'s submit and poll with the x-key masked and the result URL\'s signature masked', async () => {
    const dir = freshRecordsRoot()
    const sent = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/flux-2-pro')) return new Response(JSON.stringify({ id: 'job', polling_url: 'https://poll.example/job' }))
      if (url === 'https://poll.example/job') {
        return new Response(JSON.stringify({ status: 'Ready', result: { sample: 'https://image.example/result.png?se=2026&sig=SIGNED' } }))
      }
      return new Response(new Uint8Array([1]))
    })
    vi.stubGlobal('fetch', sent)
    await generateFlux(task('flux', 'flux-2-pro'), new AbortController().signal)

    const [submit, poll] = calls(dir)
    expect(submit!.request).toMatchObject({ url: 'https://api.bfl.ai/v1/flux-2-pro', headers: { 'x-key': '[REDACTED]' }, body: { prompt: 'a fox' } })
    expect(poll!.request).toEqual({ url: 'https://poll.example/job', headers: { 'x-key': '[REDACTED]' } })
    expect(poll!.response).toMatchObject({ body: { result: { sample: 'https://image.example/result.png?se=2026&sig=[REDACTED]' } } })
    for (const call of [submit!, poll!]) expect(call.raw).not.toContain('test-key')
    expect(sent.mock.calls[0]![1]!.headers).toMatchObject({ 'x-key': 'test-key' })
  })

  it('keep Grok\'s request with the Authorization key masked', async () => {
    const dir = freshRecordsRoot()
    const sent = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ data: [{ b64_json: 'AQ==' }] })))
    vi.stubGlobal('fetch', sent)
    await generateGrok(task('grok', 'grok-imagine-image'), new AbortController().signal)

    const [call] = calls(dir)
    expect(call!.request).toMatchObject({ headers: { Authorization: 'Bearer [REDACTED]' }, body: { prompt: 'a fox' } })
    expect(call!.raw).not.toContain('test-key')
    expect(sent.mock.calls[0]![1]!.headers).toMatchObject({ Authorization: 'Bearer test-key' })
  })
})
