// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DrawThingsModelParams, LocalModelInfo } from '../../../../src/shared/types'
import { useDrawThingsColumn } from '../../../../src/renderer/src/components/DrawThingsColumn'
import { until } from '../../until'

const params: DrawThingsModelParams = {
  width: 1024, height: 1024, steps: 4, guidance: 1, seed: '', negativePrompt: '',
}
const setModel = vi.fn()

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

afterEach(cleanup)

function installApi(store: Record<string, DrawThingsModelParams>, otherModel: string): void {
  const models: LocalModelInfo[] = ['selected', otherModel].map((file) => ({
    file, name: file, source: 'official', downloaded: true, huggingFace: null,
  }))
  window.electronAPI = {
    localCheckCli: vi.fn(async () => ({ installed: true })),
    localListDownloadedModels: vi.fn(async () => models),
    dtGetModelParams: vi.fn(async () => params),
    dtGetAllModelParams: vi.fn(async () => store),
    dtSaveModelParams: vi.fn(async () => undefined),
    resolveRecommendation: vi.fn(async () => null),
    onDrawThingsParamsPersistenceState: vi.fn(() => () => undefined),
    requestDrawThingsParamsPersistenceState: vi.fn(async () => undefined),
    onCliJobStatus: vi.fn(() => () => undefined),
    appLog: vi.fn(async () => undefined),
  } as unknown as typeof window.electronAPI
}

describe('Draw Things model dictionary after IPC cloning', () => {
  it.each(['constructor', '__proto__', 'formatVersion'])('uses an own %s model entry', async (name) => {
    const store = structuredClone(Object.fromEntries([[name, params]]))
    installApi(store, name)
    const { result } = renderHook(() => useDrawThingsColumn({ active: true, model: 'selected', setModel, settings: null }))
    await until(() => {
      expect(result.current.downloadedModelCount).toBe(2)
      expect(window.electronAPI.dtGetAllModelParams).toHaveBeenCalled()
      expect(result.current.controls.canApplyToAllModels).toBe(false)
    })
  })

  it.each(['constructor', '__proto__'])('does not treat inherited %s dimensions as saved parameters', async (name) => {
    const store = Object.create(Object.fromEntries([[name, params]])) as Record<string, DrawThingsModelParams>
    installApi(store, name)
    const { result } = renderHook(() => useDrawThingsColumn({ active: true, model: 'selected', setModel, settings: null }))
    await until(() => {
      expect(result.current.downloadedModelCount).toBe(2)
      expect(window.electronAPI.dtGetAllModelParams).toHaveBeenCalled()
      expect(result.current.controls.canApplyToAllModels).toBe(true)
    })
  })
})


describe('Draw Things resolved parameters and authored edits', () => {
  const settingsFor = (models_dir: string) => ({ image_backends: { drawthings: { models_dir } } })
  const recommendation = (width: number) => ({
    width, height: 768, steps: 12, guidance: 3, negativePrompt: 'recommended negative',
    matchName: 'selected', matchModel: 'selected', matchType: 'exact' as const,
  })

  it('does not save viewing or hydration, and saves a subsequent authored edit', async () => {
    installApi({}, 'other')
    vi.mocked(window.electronAPI.dtGetModelParams).mockResolvedValue(null)
    vi.mocked(window.electronAPI.resolveRecommendation).mockResolvedValue(recommendation(640))
    const { result } = renderHook(() => useDrawThingsColumn({ active: true, model: 'selected', setModel, settings: null }))
    await until(() => {
      expect(result.current.paramsReady).toBe(true)
      expect(result.current.controls.width).toBe('640')
    })
    expect(window.electronAPI.dtSaveModelParams).not.toHaveBeenCalled()
    act(() => result.current.controls.setWidth('896'))
    await until(() => expect(window.electronAPI.dtSaveModelParams).toHaveBeenCalledExactlyOnceWith('selected', {
      width: 896, height: 768, steps: 12, guidance: 3, seed: '', negativePrompt: 'recommended negative',
    }))
  })

  it('keeps a full saved set usable when its optional recommendation fails', async () => {
    installApi({}, 'other')
    const saved = { ...params, seed: '99', negativePrompt: 'saved negative' }
    vi.mocked(window.electronAPI.dtGetModelParams).mockResolvedValue(saved)
    vi.mocked(window.electronAPI.resolveRecommendation).mockRejectedValue(new Error('malformed recommendations'))
    const { result } = renderHook(() => useDrawThingsColumn({ active: true, model: 'selected', setModel, settings: null }))
    await until(() => expect(result.current.paramsReady).toBe(true))
    expect(result.current.controls.paramsLoadError).toBeNull()
    expect(result.current.controls.selectedRecommendation).toBeNull()
    expect(result.current.enqueueParams).toEqual({ ...saved, seed: 99 })
    expect(window.electronAPI.dtSaveModelParams).not.toHaveBeenCalled()
  })

  it('blocks unsaved parameter use when required recommendation loading fails', async () => {
    installApi({}, 'other')
    vi.mocked(window.electronAPI.dtGetModelParams).mockResolvedValue(null)
    vi.mocked(window.electronAPI.resolveRecommendation).mockRejectedValue(new Error('unreadable recommendations'))
    const { result } = renderHook(() => useDrawThingsColumn({ active: true, model: 'selected', setModel, settings: null }))
    await until(() => expect(result.current.controls.paramsLoadError).toBe('drawThings.paramsLoadFailed'))
    expect(result.current.paramsReady).toBe(false)
    expect(window.electronAPI.dtSaveModelParams).not.toHaveBeenCalled()
  })

  it('resolves the same model again when its source directory changes without saving hydration', async () => {
    installApi({}, 'other')
    vi.mocked(window.electronAPI.dtGetModelParams).mockResolvedValue(null)
    vi.mocked(window.electronAPI.resolveRecommendation)
      .mockResolvedValueOnce(recommendation(640))
      .mockResolvedValueOnce(recommendation(896))
    const { result, rerender } = renderHook(({ settings }) =>
      useDrawThingsColumn({ active: true, model: 'selected', setModel, settings }),
    { initialProps: { settings: settingsFor('/models/first') } })
    await until(() => {
      expect(result.current.paramsReady).toBe(true)
      expect(result.current.controls.width).toBe('640')
    })
    rerender({ settings: settingsFor('/models/second') })
    expect(result.current.paramsReady).toBe(false)
    await until(() => {
      expect(result.current.paramsReady).toBe(true)
      expect(result.current.controls.width).toBe('896')
    })
    expect(window.electronAPI.resolveRecommendation).toHaveBeenCalledTimes(2)
    expect(window.electronAPI.dtGetModelParams).toHaveBeenCalledTimes(2)
    expect(window.electronAPI.dtSaveModelParams).not.toHaveBeenCalled()
  })

  it('ignores an older model-list refresh after the source directory changes', async () => {
    installApi({}, 'other')
    const oldList = deferred<LocalModelInfo[]>()
    const current = [{ file: 'current', name: 'current', source: 'official', downloaded: true, huggingFace: null }]
    vi.mocked(window.electronAPI.localListDownloadedModels)
      .mockReturnValueOnce(oldList.promise)
      .mockResolvedValueOnce(current)
    const { result, rerender } = renderHook(({ settings }) =>
      useDrawThingsColumn({ active: true, model: 'selected', setModel, settings }),
    { initialProps: { settings: settingsFor('/models/first') } })
    await until(() => expect(window.electronAPI.localListDownloadedModels).toHaveBeenCalledTimes(1))
    rerender({ settings: settingsFor('/models/second') })
    expect(window.electronAPI.localListDownloadedModels).toHaveBeenCalledTimes(1)
    expect(result.current.controls.modelsLoadState).toBe('loading')
    await act(async () => {
      oldList.resolve([{ ...current[0], file: 'obsolete', name: 'obsolete' }])
      await oldList.promise
    })
    await until(() => expect(result.current.controls.downloadedModels).toEqual(current))
    expect(result.current.controls.modelsLoadState).toBe('ready')
  })

  it('ignores stale parameter resolution after a recommendation refresh', async () => {
    installApi({}, 'other')
    vi.mocked(window.electronAPI.dtGetModelParams).mockResolvedValue(null)
    const oldRecommendation = deferred<ReturnType<typeof recommendation>>()
    vi.mocked(window.electronAPI.resolveRecommendation)
      .mockReturnValueOnce(oldRecommendation.promise)
      .mockResolvedValueOnce(recommendation(896))
    const { result } = renderHook(() => useDrawThingsColumn({ active: true, model: 'selected', setModel, settings: null }))
    await until(() => expect(window.electronAPI.resolveRecommendation).toHaveBeenCalledTimes(1))
    act(() => window.dispatchEvent(new Event('dependencies-changed')))
    await until(() => {
      expect(result.current.paramsReady).toBe(true)
      expect(result.current.controls.width).toBe('896')
    })
    await act(async () => {
      oldRecommendation.resolve(recommendation(640))
      await oldRecommendation.promise
    })
    expect(result.current.controls.width).toBe('896')
    expect(result.current.paramsReady).toBe(true)
    expect(window.electronAPI.dtSaveModelParams).not.toHaveBeenCalled()
  })
})
