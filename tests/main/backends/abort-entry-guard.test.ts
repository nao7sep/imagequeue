import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../../../src/shared/types'

// The three backends with manual abort wiring attach their listener to the
// queue's signal — and a signal that is ALREADY aborted never fires its
// listener. Today no await sits between the processor's registration and the
// attachment, so the case is unreachable; these pin the entry guard that keeps
// one future refactor from turning a Stop into a silently ignored request
// (and a paid call).

vi.mock('../../../src/main/config', () => ({
  loadConfig: () => ({
    image_backends: {
      grok: { timeout_ms: 1000 },
      flux: { timeout_ms: 1000 },
    },
  }),
}))
vi.mock('../../../src/main/config/api-keys-store', () => ({
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
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'job-1', polling_url: 'https://poll.test/job-1' }),
    })
    const controller = new AbortController()
    const generation = generateFlux(task, controller.signal)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    controller.abort()
    await expect(generation).rejects.toThrow(CANCELLED_MESSAGE)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
