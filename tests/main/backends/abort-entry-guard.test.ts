import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../../../src/shared/types'

// Manual abort wiring must also handle a signal aborted before listener
// attachment. Grok and FLUX can reach that state while refreshing credentials;
// these entry checks prevent a pending Stop from starting paid work.

vi.mock('../../../src/main/config', () => ({
  loadConfig: () => ({
    image_backends: {
      grok: { timeout_ms: 1000 },
      flux: { timeout_ms: 1000 },
    },
  }),
}))
vi.mock('../../../src/main/config/api-keys-store', () => ({ refreshApiKeys: async () => undefined,
  resolveApiKey: () => 'test-key',
}))

const { generateGrok } = await import('../../../src/main/backends/grok')
const { generateFlux } = await import('../../../src/main/backends/flux')
const { CANCELLED_MESSAGE } = await import('../../../src/main/backends/cancellation')

const task = { id: 't', prompt: 'p', model: 'm', params: {} } as unknown as Task

function abortedSignal(): AbortSignal {
  const controller = new AbortController()
  controller.abort()
  return controller.signal
}

const fetchSpy = vi.fn()

beforeEach(() => {
  fetchSpy.mockReset()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('an already-aborted signal is answered at the door', () => {
  it('grok: rejects as cancelled without touching the network', async () => {
    await expect(generateGrok(task, abortedSignal())).rejects.toThrow(CANCELLED_MESSAGE)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('flux: rejects as cancelled without touching the network', async () => {
    await expect(generateFlux(task, abortedSignal())).rejects.toThrow(CANCELLED_MESSAGE)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('FLUX polling cancellation', () => {
  it('wakes the poll delay immediately and starts no poll request', async () => {
    vi.useFakeTimers()
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'job-1', polling_url: 'https://api.bfl.ai/v1/get_result?id=job-1' })))
    const controller = new AbortController()
    const generation = generateFlux(task, controller.signal)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    controller.abort()
    await expect(generation).rejects.toThrow(CANCELLED_MESSAGE)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
