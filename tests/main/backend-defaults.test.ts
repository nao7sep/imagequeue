import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const updateConfig = vi.hoisted(() => vi.fn())
vi.mock('../../src/main/config', () => ({ updateConfig }))
vi.mock('../../src/main/logger', () => ({ log: vi.fn(), serializeError: String }))
let api: typeof import('../../src/main/backend-defaults')
beforeEach(async () => { vi.resetModules(); vi.useFakeTimers(); updateConfig.mockReset(); updateConfig.mockResolvedValue(undefined); api = await import('../../src/main/backend-defaults') })
afterEach(() => vi.useRealTimers())
describe('main-owned backend defaults', () => {
  it('retains the latest edit independently of its renderer and flushes without the debounce delay', async () => {
    const first = api.saveImageBackendDefaults('openai', 'a', { width: 1 })
    const params = { width: 2 }
    const last = api.saveImageBackendDefaults('openai', 'b', params)
    params.width = 9
    const other = api.saveImageBackendDefaults('flux', 'flux', { width: 3 })
    expect(updateConfig).not.toHaveBeenCalled()
    await api.drainBackendDefaults()
    await Promise.all([first, last, other])
    const config = { image_backends: { openai: {}, flux: {} } }
    updateConfig.mock.calls[0][0](config)
    expect(config.image_backends).toEqual({ openai: { model: 'b', default_params: { width: 2 } }, flux: { model: 'flux', default_params: { width: 3 } } })
    expect(updateConfig).toHaveBeenCalledOnce()
  })
  it('reports save failure but retains its captured edit for quit Retry', async () => {
    updateConfig.mockRejectedValueOnce(new Error('full'))
    const save = api.saveImageBackendDefaults('openai', 'a', { width: 1 })
    const failed = expect(save).rejects.toThrow('full')
    await vi.advanceTimersByTimeAsync(800)
    await failed
    await api.drainBackendDefaults()
    expect(updateConfig).toHaveBeenCalledTimes(2)
    const config = { image_backends: { openai: {} } }
    updateConfig.mock.calls[1][0](config)
    expect(config.image_backends.openai).toEqual({ model: 'a', default_params: { width: 1 } })
  })
})
