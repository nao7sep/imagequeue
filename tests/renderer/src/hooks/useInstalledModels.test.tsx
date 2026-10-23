// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useInstalledModels } from '../../../../src/renderer/src/hooks/useInstalledModels'
import type { CliStatus, LocalModelInfo } from '../../../../src/shared/types'
import type { CliStatusEvent } from '../../../../src/shared/cli-jobs'
import { until } from '../../until'

const originalApi = Object.getOwnPropertyDescriptor(window, 'electronAPI')
const installed: CliStatus = { installed: true, version: '1', path: '/cli', platform: 'darwin' }
const model: LocalModelInfo = { file: 'model.ckpt', name: 'Model', source: 'official', downloaded: true, huggingFace: null }

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}

function api() {
  const jobListeners = new Set<(event: CliStatusEvent) => void>()
  const stopJobs = vi.fn()
  const localCheckCli = vi.fn<() => Promise<CliStatus>>().mockResolvedValue(installed)
  const localListDownloadedModels = vi.fn<() => Promise<LocalModelInfo[]>>().mockResolvedValue([{ ...model }])
  const onCliJobStatus = vi.fn((listener: (event: CliStatusEvent) => void) => {
    jobListeners.add(listener)
    return () => { jobListeners.delete(listener); stopJobs() }
  })
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { localCheckCli, localListDownloadedModels, onCliJobStatus },
  })
  return {
    localCheckCli, localListDownloadedModels, onCliJobStatus, stopJobs,
    emitJob(status: CliStatusEvent['status']) {
      act(() => jobListeners.forEach((listener) => listener({ jobId: 'job', status, exitCode: null, stalled: false })))
    },
  }
}

function invalidate(event = 'focus'): void {
  act(() => { window.dispatchEvent(new Event(event)) })
}

afterEach(() => {
  cleanup()
  if (originalApi) Object.defineProperty(window, 'electronAPI', originalApi)
  else delete (window as unknown as { electronAPI?: unknown }).electronAPI
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useInstalledModels', () => {
  it('shares one initial scan and one set of refresh observers across simultaneous consumers', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const backend = api()
    const checking = deferred<CliStatus>()
    backend.localCheckCli.mockReturnValueOnce(checking.promise)
    const first = renderHook(() => useInstalledModels(true, '/models'))
    const second = renderHook(() => useInstalledModels(true, '/models'))
    expect(first.result.current.status).toBe('loading')
    expect(backend.localCheckCli).toHaveBeenCalledTimes(1)
    expect(backend.localListDownloadedModels).not.toHaveBeenCalled()
    await act(async () => { checking.resolve(installed) })
    await until(() => expect(second.result.current.status === 'ready').toBe(true))
    expect(first.result.current).toBe(second.result.current)
    expect(first.result.current.cliStatus).toEqual(installed)
    expect(backend.localListDownloadedModels).toHaveBeenCalledTimes(1)
    expect(backend.onCliJobStatus).toHaveBeenCalledTimes(1)

    invalidate()
    await until(() => expect(first.result.current.revision === 2).toBe(true))
    invalidate('dependencies-changed')
    await until(() => expect(first.result.current.revision === 3).toBe(true))
    await act(async () => { vi.advanceTimersByTime(30_000) })
    await until(() => expect(first.result.current.revision === 4).toBe(true))
    expect(backend.localCheckCli).toHaveBeenCalledTimes(4)
    expect(backend.localListDownloadedModels).toHaveBeenCalledTimes(4)
    expect(first.result.current).toBe(second.result.current)
  })

  it.each([
    { name: 'Renamed model' },
    { source: 'imported' },
    { downloaded: false },
    { huggingFace: 'owner/model' },
  ])('delivers changed metadata for the same filename: %j', async (change) => {
    const backend = api()
    const { result } = renderHook(() => useInstalledModels(true, '/models'))
    await until(() => expect(result.current.status === 'ready').toBe(true))
    const previous = result.current.models
    const changed = { ...model, ...change }
    backend.localListDownloadedModels.mockResolvedValue([changed])
    invalidate()
    await until(() => expect(result.current.revision === 2).toBe(true))
    expect(result.current.models).toEqual([changed])
    expect(result.current.models).not.toBe(previous)
    const updated = result.current.models
    backend.localListDownloadedModels.mockResolvedValue([{ ...changed }])
    invalidate()
    await until(() => expect(result.current.revision === 3).toBe(true))
    expect(result.current.models).toBe(updated)
  })

  it('waits for an old directory scan to settle and coalesces overlapping invalidations into one latest scan', async () => {
    const backend = api()
    const oldList = deferred<LocalModelInfo[]>()
    const latestList = deferred<LocalModelInfo[]>()
    backend.localListDownloadedModels.mockReturnValueOnce(oldList.promise).mockReturnValueOnce(latestList.promise)
    const { result, rerender } = renderHook(({ directory }) => useInstalledModels(true, directory), {
      initialProps: { directory: '/old' },
    })
    await until(() => expect(backend.localListDownloadedModels.mock.calls.length === 1).toBe(true))
    rerender({ directory: '/new' })
    invalidate()
    invalidate('dependencies-changed')
    backend.emitJob('exited')
    expect(backend.localCheckCli).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('loading')
    await act(async () => { oldList.resolve([{ ...model, name: 'Stale result' }]) })
    await until(() => expect(backend.localListDownloadedModels.mock.calls.length === 2).toBe(true))
    expect(result.current.models).toEqual([])
    expect(result.current.status).toBe('loading')
    const latest = { ...model, name: 'Latest result' }
    await act(async () => { latestList.resolve([latest]) })
    await until(() => expect(result.current.status === 'ready').toBe(true))
    expect(result.current.directory).toBe('/new')
    expect(result.current.models).toEqual([latest])
    expect(backend.localCheckCli).toHaveBeenCalledTimes(2)
    expect(backend.localListDownloadedModels).toHaveBeenCalledTimes(2)
  })

  it.each(['exited', 'killed', 'timed-out'] as const)('refreshes all consumers on terminal job %s, including a later subscriber', async (status) => {
    const backend = api()
    const first = renderHook(() => useInstalledModels(true, '/models'))
    await until(() => expect(first.result.current.status === 'ready').toBe(true))
    const second = renderHook(() => useInstalledModels(true, '/models'))
    expect(second.result.current).toBe(first.result.current)
    expect(backend.localCheckCli).toHaveBeenCalledTimes(1)
    backend.emitJob('running')
    expect(backend.localCheckCli).toHaveBeenCalledTimes(1)
    const changed = { ...model, file: 'new.ckpt', name: 'New model' }
    backend.localListDownloadedModels.mockResolvedValue([changed])
    backend.emitJob(status)
    await until(() => expect(second.result.current.revision === 2).toBe(true))
    expect(first.result.current.models).toEqual([changed])
    expect(second.result.current).toBe(first.result.current)
    expect(backend.localCheckCli).toHaveBeenCalledTimes(2)
  })

  it('preserves physical scan ownership across the final unmount and a new subscription', async () => {
    const backend = api()
    const oldCheck = deferred<CliStatus>()
    backend.localCheckCli.mockReturnValueOnce(oldCheck.promise)
    const first = renderHook(() => useInstalledModels(true, '/old'))
    first.unmount()
    const second = renderHook(() => useInstalledModels(true, '/new'))
    expect(backend.localCheckCli).toHaveBeenCalledTimes(1)
    expect(backend.localListDownloadedModels).not.toHaveBeenCalled()
    await act(async () => { oldCheck.resolve(installed) })
    await until(() => expect(second.result.current.status === 'ready').toBe(true))
    expect(second.result.current.directory).toBe('/new')
    expect(second.result.current.models).toEqual([model])
    expect(backend.localCheckCli).toHaveBeenCalledTimes(2)
    expect(backend.localListDownloadedModels).toHaveBeenCalledTimes(1)
  })

  it('reports a missing CLI without reading models, then refreshes after dependencies change', async () => {
    const backend = api()
    const missing: CliStatus = { ...installed, installed: false, version: null, path: null }
    backend.localCheckCli.mockResolvedValueOnce(missing)
    const { result } = renderHook(() => useInstalledModels(true, '/models'))
    await until(() => expect(result.current.status === 'ready').toBe(true))
    expect(result.current.cliStatus).toEqual(missing)
    expect(result.current.models).toEqual([])
    expect(result.current.error).toBeNull()
    expect(backend.localListDownloadedModels).not.toHaveBeenCalled()
    invalidate('dependencies-changed')
    await until(() => expect(result.current.revision === 2).toBe(true))
    expect(result.current.cliStatus).toEqual(installed)
    expect(result.current.models).toEqual([model])
    expect(backend.localListDownloadedModels).toHaveBeenCalledTimes(1)
  })

  it.each(['check', 'list'] as const)('retains the old list on %s failure and clears its error after recovery', async (operation) => {
    const backend = api()
    const { result } = renderHook(() => useInstalledModels(true, '/models'))
    await until(() => expect(result.current.status === 'ready').toBe(true))
    const previous = result.current.models
    if (operation === 'check') backend.localCheckCli.mockRejectedValueOnce(new Error('CLI read failed'))
    else backend.localListDownloadedModels.mockRejectedValueOnce(new Error('Models read failed'))
    invalidate()
    await until(() => expect(result.current.status === 'failed').toBe(true))
    expect(result.current.models).toBe(previous)
    expect(result.current.error).toBe(operation === 'check' ? 'failure.drawthingsCliLoad' : 'failure.drawthingsModelsPoll')
    invalidate()
    await until(() => expect(result.current.status === 'ready').toBe(true))
    expect(result.current.models).toBe(previous)
    expect(result.current.error).toBeNull()
    expect(result.current.cliStatus).toEqual(installed)
  })

  it('does no acquisition or observation while inactive', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const backend = api()
    const { result } = renderHook(() => useInstalledModels(false, '/models'))
    invalidate()
    invalidate('dependencies-changed')
    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(result.current.status).toBe('ready')
    expect(result.current.models).toEqual([])
    expect(backend.localCheckCli).not.toHaveBeenCalled()
    expect(backend.localListDownloadedModels).not.toHaveBeenCalled()
    expect(backend.onCliJobStatus).not.toHaveBeenCalled()
  })

  it('keeps observers until the final consumer leaves, then removes listeners and periodic work', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const backend = api()
    const remove = vi.spyOn(window, 'removeEventListener')
    const first = renderHook(() => useInstalledModels(true, '/models'))
    const second = renderHook(() => useInstalledModels(true, '/models'))
    await until(() => expect(second.result.current.status === 'ready').toBe(true))
    first.unmount()
    expect(backend.stopJobs).not.toHaveBeenCalled()
    invalidate()
    await until(() => expect(second.result.current.revision === 2).toBe(true))
    second.unmount()
    expect(backend.stopJobs).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith('focus', expect.any(Function))
    expect(remove).toHaveBeenCalledWith('dependencies-changed', expect.any(Function))
    invalidate()
    invalidate('dependencies-changed')
    backend.emitJob('exited')
    await act(async () => { vi.advanceTimersByTime(90_000) })
    expect(backend.localCheckCli).toHaveBeenCalledTimes(2)
    expect(backend.localListDownloadedModels).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})
