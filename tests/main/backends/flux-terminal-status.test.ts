import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../../../src/shared/types'

// BFL ends a moderated request with a status of its own ("Request Moderated",
// "Content Moderated", "Task not found"). Only Ready/Error/Failed used to stop
// the poll, so a moderated prompt held a FLUX slot for the whole 180 s and then
// failed as "timed out" — and the user paid again retrying the same prompt.

vi.mock('../../../src/main/config', () => ({
  loadConfig: () => ({ image_backends: { flux: { timeout_ms: 180000 } } }),
}))
vi.mock('../../../src/main/config/api-keys-store', () => ({ resolveApiKey: () => 'bfl-test' }))
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
  id: 't1', prompt: 'p', backend: 'flux', model: 'flux-2-pro', params: {},
  status: 'generating', enqueuedAt: '2026-01-01T00:00:00.000Z', startedAt: null,
  completedAt: null, durationMs: null, imagePath: null, baseName: null, error: null,
}

function stubPolls(statuses: string[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/flux-2-pro')) {
      return new Response(JSON.stringify({ id: 'job', polling_url: 'https://poll.example/job' }))
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
      if (url.endsWith('/flux-3-image')) return new Response(JSON.stringify({ id: 'job', polling_url: 'https://poll.example/job' }))
      if (url === 'https://poll.example/job') {
        const status = statuses.shift()!
        return new Response(JSON.stringify(status === 'Ready' ? { status, result: { sample: 'https://image.example/result' } } : { status }))
      }
      return new Response(new Uint8Array([1, 2, 3]))
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await generateFlux({ ...task, model: 'flux-3-image', params: { aspectRatio: '1:1', resolution: '1k' } }, new AbortController().signal)
    expect(result.buffer).toEqual(Buffer.from([1, 2, 3]))
    expect(result, 'FLUX 3 sends no seed').not.toHaveProperty('seed')
    expect(fetchMock.mock.calls.filter(([url]) => url === 'https://poll.example/job')).toHaveLength(3)
  })
})

describe('FLUX safe poll retry', () => {
  it('retries a 503 poll on the same submitted job', async () => {
    let polls = 0
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/flux-2-pro')) return new Response(JSON.stringify({ id: 'job', polling_url: 'https://poll.example/job' }))
      if (url === 'https://poll.example/job') {
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
    expect(fetchMock.mock.calls.filter(([url]) => url === 'https://poll.example/job')).toHaveLength(2)
  })
})
