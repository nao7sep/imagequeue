// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DrawThingsModelParams, LocalModelInfo } from '../../../../src/shared/types'
import { useDrawThingsColumn } from '../../../../src/renderer/src/components/DrawThingsColumn'
import { until } from '../../until'

const params: DrawThingsModelParams = {
  width: 1024, height: 1024, steps: 4, guidance: 1, seed: '', negativePrompt: '',
}
const setModel = vi.fn()

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
    getDrawThingsParamsPersistenceState: vi.fn(async () => ({ status: 'saved' })),
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
