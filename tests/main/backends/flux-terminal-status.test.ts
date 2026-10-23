import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../../../src/shared/types'
import { columnParams } from './column-params'

// BFL ends a moderated request with a status of its own ("Request Moderated",
// "Content Moderated", "Task not found"). Only Ready/Error/Failed used to stop
// the poll, so a moderated prompt held a FLUX slot for the whole 180 s and then
// failed as "timed out" — and the user paid again retrying the same prompt.

vi.mock('../../../src/main/config', () => ({
  loadConfig: () => ({ image_backends: { flux: { timeout_ms: 180000 } } }),
}))
vi.mock('../../../src/main/config/api-keys-store', () => ({ refreshApiKeys: async () => undefined, resolveApiKey: () => 'bfl-test' }))
vi.mock('../../../src/main/logger', () => ({ log: vi.fn() }))
vi.mock('../../../src/main/utils/abortable-delay', () => ({ abortableDelay: async () => undefined }))

const { generateFlux } = await import('../../../src/main/backends/flux')
const failurePresentation = await import('../../../src/main/failure-presentation')
const { loadTranslator } = await import('../../../src/shared/i18n/translate')
// The task keeps a message; these read it as English shows it.
const english = await loadTranslator('en')
const generationFailurePresentation = (...args: Parameters<typeof failurePresentation.generationFailurePresentation>): string =>
  english.text(failurePresentation.generationFailurePresentation(...args))

const task: Task = {
  id: 't1', prompt: 'p', backend: 'flux', model: 'flux-2-pro', params: columnParams('flux', 'flux-2-pro'),
  status: 'generating', enqueuedAt: '2026-01-01T00:00:00.000Z', startedAt: null,
  completedAt: null, durationMs: null, imagePath: null, baseName: null, error: null, providerMessage: null,
}

function stubPolls(statuses: string[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/flux-2-pro')) {
      return new Response(JSON.stringify({ id: 'job', polling_url: 'https://api.bfl.ai/v1/get_result?id=job' }))
    }
    return new Response(JSON.stringify({ status: statuses.shift() ?? 'Pending' }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FLUX polling', () => {
  it.each(['Request Moderated', 'Content Moderated', 'Task not found', 'Error', 'Failed'])(
    'ends at once on "%s" and reports that status, not a timeout',
    async (status) => {
      const fetchMock = stubPolls(['Pending', 'Processing', status])
      const error = await generateFlux(task, new AbortController().signal).catch((err: unknown) => err)

      expect(fetchMock).toHaveBeenCalledTimes(4)
      expect(error).toMatchObject({ providerStatus: status })
      const shown = generationFailurePresentation('flux', error, false)
      expect(shown).toContain(status)
      expect(shown).not.toMatch(/time/i)
    },
  )

  it('polls on through FLUX 3\'s Reasoning and Generating statuses to the image', async () => {
    const statuses = ['Reasoning', 'Generating', 'Ready']
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/flux-3-image')) return new Response(JSON.stringify({ id: 'job', polling_url: 'https://api.bfl.ai/v1/get_result?id=job' }))
      if (url === 'https://api.bfl.ai/v1/get_result?id=job') {
        const status = statuses.shift()!
        return new Response(JSON.stringify(status === 'Ready' ? { status, result: { sample: 'https://image.example/result' } } : { status }))
      }
      return new Response(new Uint8Array([1, 2, 3]))
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await generateFlux({ ...task, model: 'flux-3-image', params: { aspectRatio: '1:1', resolution: '1k' } }, new AbortController().signal)
    expect(result.buffer).toEqual(Buffer.from([1, 2, 3]))
    expect(result, 'FLUX 3 sends no seed').not.toHaveProperty('seed')
    expect(fetchMock.mock.calls.filter(([url]) => url === 'https://api.bfl.ai/v1/get_result?id=job')).toHaveLength(3)
  })
})

describe('FLUX safe poll retry', () => {
  it('retries a 503 poll on the same submitted job', async () => {
    let polls = 0
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/flux-2-pro')) return new Response(JSON.stringify({ id: 'job', polling_url: 'https://api.bfl.ai/v1/get_result?id=job' }))
      if (url === 'https://api.bfl.ai/v1/get_result?id=job') {
        polls++
        return polls === 1
          ? new Response('{"detail":"busy"}', { status: 503, headers: { 'retry-after': '0' } })
          : new Response(JSON.stringify({ status: 'Ready', result: { sample: 'https://image.example/result' } }))
      }
      return new Response(new Uint8Array([1, 2, 3]))
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await generateFlux(task, new AbortController().signal)
    expect(result.buffer).toEqual(Buffer.from([1, 2, 3]))
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/flux-2-pro'))).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([url]) => url === 'https://api.bfl.ai/v1/get_result?id=job')).toHaveLength(2)
  })
})


describe('FLUX authenticated destination boundaries', () => {
  const pollUrl = 'https://api.bfl.ai/v1/get_result?id=job'
  const imageUrl = 'https://image.example/result'
  const ready = () => new Response(JSON.stringify({ status: 'Ready', result: { sample: imageUrl } }))

  it.each([
    'https://attacker.example/job', 'http://api.bfl.ai/job', 'https://api.bfl.ai.attacker.example/job',
    'https://sub.api.bfl.ai/job', 'https://api.bfl.ai:444/job',
    'https://user:password@api.bfl.ai/job', 'https://user@api.eu.bfl.ai/job', 'file:///tmp/job',
  ])('rejects hostile polling URL %s before any authenticated poll', async (polling_url) => {
    const sent = vi.fn(async () => new Response(JSON.stringify({ id: 'job', polling_url })))
    vi.stubGlobal('fetch', sent)
    await expect(generateFlux(task, new AbortController().signal)).rejects.toThrow('untrusted API destination')
    expect(sent).toHaveBeenCalledTimes(1)
    expect(sent.mock.calls[0]).toMatchObject(['https://api.bfl.ai/v1/flux-2-pro', { redirect: 'manual', headers: { 'x-key': 'bfl-test' } }])
  })

  it.each(['https://api.bfl.ai', 'https://api.eu.bfl.ai', 'https://api.us.bfl.ai'])(
    'allows authenticated polling at documented origin %s', async (origin) => {
      const polling_url = `${origin}/v1/get_result?id=job`
      const sent = vi.fn(async (url: string, _init?: RequestInit) => {
        if (url.endsWith('/flux-2-pro')) return new Response(JSON.stringify({ id: 'job', polling_url }))
        if (url === polling_url) return ready()
        return new Response(new Uint8Array([1, 2, 3]))
      })
      vi.stubGlobal('fetch', sent)
      expect((await generateFlux(task, new AbortController().signal)).buffer).toEqual(Buffer.from([1, 2, 3]))
      expect(sent.mock.calls[1]).toMatchObject([polling_url, { redirect: 'manual', headers: { 'x-key': 'bfl-test' } }])
      expect(sent.mock.calls[2]).toEqual([imageUrl, expect.not.objectContaining({ headers: expect.anything() })])
    },
  )

  it.each(['submit', 'poll'])('does not forward credentials on a foreign %s redirect', async (phase) => {
    const sent = vi.fn(async (url: string, _init?: RequestInit) => {
      if (phase === 'submit' || url === pollUrl) return new Response(null, { status: 307, headers: { location: 'https://attacker.example/collect' } })
      return new Response(JSON.stringify({ id: 'job', polling_url: pollUrl }))
    })
    vi.stubGlobal('fetch', sent)
    await expect(generateFlux(task, new AbortController().signal)).rejects.toThrow('untrusted API destination')
    expect(sent).toHaveBeenCalledTimes(phase === 'submit' ? 1 : 2)
    expect(sent.mock.calls.every(([url, init]) => new URL(url).origin === 'https://api.bfl.ai' && init?.redirect === 'manual')).toBe(true)
  })

  it.each([301, 302, 303])('rejects a submission redirect with status %s before resubmitting', async (status) => {
    const sent = vi.fn(async () => new Response(null, { status, headers: { location: 'https://api.eu.bfl.ai/v1/flux-2-pro' } }))
    vi.stubGlobal('fetch', sent)
    await expect(generateFlux(task, new AbortController().signal)).rejects.toThrow('unsupported redirect')
    expect(sent).toHaveBeenCalledTimes(1)
  })

  it.each([307, 308])('preserves POST body and credentials across a trusted %s submission redirect', async (status) => {
    const regional = 'https://api.eu.bfl.ai/v1/flux-2-pro'
    const sent = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === 'https://api.bfl.ai/v1/flux-2-pro') return new Response(null, { status, headers: { location: regional } })
      if (url === regional) return new Response(JSON.stringify({ id: 'job', polling_url: pollUrl }))
      if (url === pollUrl) return ready()
      return new Response(new Uint8Array([1]))
    })
    vi.stubGlobal('fetch', sent)
    await generateFlux(task, new AbortController().signal)
    expect(sent.mock.calls[1]).toEqual([regional, sent.mock.calls[0][1]])
    expect(sent.mock.calls[1][1]).toMatchObject({ method: 'POST', headers: { 'x-key': 'bfl-test' }, body: expect.any(String), redirect: 'manual' })
  })

  it('stops a trusted redirect loop after ten redirects', async () => {
    const sent = vi.fn(async () => new Response(null, { status: 307, headers: { location: '/v1/flux-2-pro' } }))
    vi.stubGlobal('fetch', sent)
    await expect(generateFlux(task, new AbortController().signal)).rejects.toThrow('redirect did not resolve')
    expect(sent).toHaveBeenCalledTimes(11)
  })
})
