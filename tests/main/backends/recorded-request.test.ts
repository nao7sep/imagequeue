import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../../../src/shared/types'

// Nothing is cut (data-lifecycle-conventions): the FLUX and Grok backends hand
// the records the request they send, its headers and the key they carry included.

vi.mock('../../../src/main/config', () => ({
  loadConfig: () => ({ image_backends: { flux: { timeout_ms: 180000 }, grok: { timeout_ms: 180000 } } }),
}))
vi.mock('../../../src/main/config/api-keys-store', () => ({ resolveApiKey: () => 'test-key' }))
vi.mock('../../../src/main/logger', () => ({ log: vi.fn(), serializeError: (error: unknown) => error }))
vi.mock('../../../src/main/utils/abortable-delay', () => ({ abortableDelay: async () => undefined }))
const recorded = vi.hoisted(() => [] as { call: { request: unknown }; init: RequestInit }[])
vi.mock('../../../src/main/records', () => ({
  fetchRecorded: async (call: { request: unknown }, url: string, init: RequestInit) => {
    recorded.push({ call, init })
    const response = await fetch(url, init)
    return { response, text: await response.text() }
  },
}))

const { generateFlux } = await import('../../../src/main/backends/flux')
const { generateGrok } = await import('../../../src/main/backends/grok')

const task = (backend: 'flux' | 'grok', model: string): Task => ({
  id: 't1', prompt: 'a fox', backend, model, params: {},
  status: 'generating', enqueuedAt: '2026-01-01T00:00:00.000Z', startedAt: null,
  completedAt: null, durationMs: null, imagePath: null, baseName: null, error: null,
})

afterEach(() => {
  recorded.length = 0
  vi.unstubAllGlobals()
})

describe('recorded image requests', () => {
  it('keep FLUX\'s submit and poll whole, the x-key header included', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/flux-2-pro')) return new Response(JSON.stringify({ id: 'job', polling_url: 'https://poll.example/job' }))
      if (url === 'https://poll.example/job') return new Response(JSON.stringify({ status: 'Ready', result: { sample: 'https://image.example/result' } }))
      return new Response(new Uint8Array([1]))
    }))
    await generateFlux(task('flux', 'flux-2-pro'), new AbortController().signal)
    expect(recorded).toHaveLength(2)
    for (const { call, init } of recorded) {
      expect(call.request).toMatchObject({ headers: { 'x-key': 'test-key' } })
      expect((call.request as { headers: unknown }).headers).toEqual(init.headers)
    }
    expect(recorded[0]!.call.request).toMatchObject({ body: { prompt: 'a fox' } })
  })

  it('keep Grok\'s request whole, the Authorization header included', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: 'AQ==' }] }))))
    await generateGrok(task('grok', 'grok-imagine-image'), new AbortController().signal)
    expect(recorded).toHaveLength(1)
    const { call, init } = recorded[0]!
    expect(call.request).toMatchObject({ headers: { Authorization: 'Bearer test-key' }, body: { prompt: 'a fox' } })
    expect((call.request as { headers: unknown }).headers).toEqual(init.headers)
  })
})
