import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DrawThingsModelParams } from '../../src/shared/types'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}))

const params: DrawThingsModelParams = { width: 1024, height: 768, steps: 20, guidance: 4.5, seed: '', negativePrompt: '' }

// The store reads params.json once per process, so each test starts a fresh module.
describe('params.json format version', () => {
  let root: string
  const file = () => path.join(root, 'params.json')
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-params-'))
    vi.stubEnv('IMAGEQUEUE_DATA_DIR', root)
    vi.resetModules()
  })
  afterEach(async () => {
    const { closeBackupStore } = await import('../../src/main/backup/backup-store')
    closeBackupStore()
    vi.unstubAllEnvs()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const setAsideCopies = () => fs.readdirSync(root).filter((name) => /^params-\d{8}-\d{6}-\d{3}-utc\.invalid$/.test(name))

  it.each([
    ['no format version', JSON.stringify({ 'model.ckpt': params })],
    ['text that is not JSON', '{ "model.ckpt": '],
    ['a value that is not a map of sets', JSON.stringify([params])],
    ['the disposable flat development format', JSON.stringify({ formatVersion: 1, 'model.ckpt': params })],
    ['an invalid model map', JSON.stringify({ formatVersion: 1, models: [] })],
  ])('sets aside a file with %s and continues from recommended or default parameters', async (_case, bytes) => {
    fs.writeFileSync(file(), bytes)
    const { getModelParams, setModelParams, drainPendingWrites, drainSetAsideModelParamsPaths } = await import('../../src/main/model-params')
    expect(getModelParams('model.ckpt')).toBeNull()
    const [copy] = setAsideCopies()
    expect(fs.readFileSync(path.join(root, copy), 'utf8'), 'the authored bytes are preserved').toBe(bytes)
    expect(drainSetAsideModelParamsPaths()).toEqual([path.join(root, copy)])
    expect(drainSetAsideModelParamsPaths(), 'each set-aside copy is named once').toEqual([])

    setModelParams('model.ckpt', params)
    drainPendingWrites()
    expect(JSON.parse(fs.readFileSync(file(), 'utf8')).models['model.ckpt']).toEqual(params)
    expect(setAsideCopies()).toEqual([copy])
  })

  it('reads a malformed set as absent, keeps the valid ones, and writes it back until that model changes', async () => {
    const { FORMAT_VERSIONS } = await import('../../src/main/store-format')
    fs.writeFileSync(file(), JSON.stringify({
      formatVersion: FORMAT_VERSIONS.modelParams,
      models: {
        'good.ckpt': params,
        'numeric-negative.ckpt': { ...params, negativePrompt: 7 },
        'missing-steps.ckpt': { width: 512, height: 512, guidance: 2, seed: '', negativePrompt: '' },
        'not-a-set.ckpt': 'x',
      },
    }))
    const { getModelParams, getAllModelParams, setModelParams, drainPendingWrites, drainSetAsideModelParamsPaths } =
      await import('../../src/main/model-params')
    expect(getAllModelParams()).toEqual({ 'good.ckpt': params })
    expect(getModelParams('numeric-negative.ckpt')).toBeNull()
    expect(getModelParams('missing-steps.ckpt')).toBeNull()
    expect(drainSetAsideModelParamsPaths(), 'a bad set is not a bad file').toEqual([])

    setModelParams('other.ckpt', params)
    drainPendingWrites()
    const models = JSON.parse(fs.readFileSync(file(), 'utf8')).models
    expect(Object.keys(models).sort()).toEqual(['good.ckpt', 'missing-steps.ckpt', 'not-a-set.ckpt', 'numeric-negative.ckpt', 'other.ckpt'])
    expect(models['not-a-set.ckpt']).toBe('x')

    setModelParams('not-a-set.ckpt', params)
    drainPendingWrites()
    expect(JSON.parse(fs.readFileSync(file(), 'utf8')).models['not-a-set.ckpt']).toEqual(params)
  })

  it('keeps keys it does not know beside the model map', async () => {
    const { FORMAT_VERSIONS } = await import('../../src/main/store-format')
    fs.writeFileSync(file(), JSON.stringify({ formatVersion: FORMAT_VERSIONS.modelParams, later: { kept: true }, models: {} }))
    const { setModelParams, drainPendingWrites } = await import('../../src/main/model-params')
    setModelParams('model.ckpt', params)
    drainPendingWrites()
    expect(JSON.parse(fs.readFileSync(file(), 'utf8')).later).toEqual({ kept: true })
  })

  it('stops the request and leaves the file in place when it cannot be set aside', async () => {
    const { StoreLeftInPlaceError } = await import('../../src/main/store-format')
    const bytes = '{ not json'
    fs.writeFileSync(file(), bytes)
    const { getModelParams, setModelParams, drainPendingWrites } = await import('../../src/main/model-params')
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('simulated permission failure'), { code: 'EACCES' })
    })
    expect(() => getModelParams('model.ckpt')).toThrow(StoreLeftInPlaceError)
    expect(() => setModelParams('model.ckpt', params)).toThrow(StoreLeftInPlaceError)
    rename.mockRestore()
    drainPendingWrites()
    expect(fs.readFileSync(file(), 'utf8')).toBe(bytes)
    expect(setAsideCopies()).toEqual([])
  })

  it('writes its format version first and reads it back', async () => {
    const { FORMAT_VERSIONS } = await import('../../src/main/store-format')
    const { setModelParams, drainPendingWrites } = await import('../../src/main/model-params')
    setModelParams('model.ckpt', params)
    drainPendingWrites()
    expect(Object.entries(JSON.parse(fs.readFileSync(file(), 'utf8')))).toEqual([
      ['formatVersion', FORMAT_VERSIONS.modelParams],
      ['models', { 'model.ckpt': params }],
    ])
    vi.resetModules()
    const reloaded = await import('../../src/main/model-params')
    expect(reloaded.getAllModelParams()).toEqual({ 'model.ckpt': params })
  })

  it('treats inherited names as absent on a fresh store', async () => {
    const { getModelParams, getAllModelParams } = await import('../../src/main/model-params')
    for (const name of ['constructor', '__proto__', 'formatVersion', 'toString']) {
      expect(getModelParams(name)).toBeNull()
      expect(Object.hasOwn(getAllModelParams(), name)).toBe(false)
    }
    expect(fs.existsSync(file())).toBe(false)
  })

  it('saves, reloads, and applies dimensions to arbitrary model names without changing its marker', async () => {
    const names = ['constructor', '__proto__', 'formatVersion', 'models']
    const api = await import('../../src/main/model-params')
    for (const name of names) api.setModelParams(name, { ...params, seed: name })
    api.drainPendingWrites()
    const stored = JSON.parse(fs.readFileSync(file(), 'utf8'))
    expect(stored.formatVersion).toBe(1)
    expect(Object.keys(stored.models)).toEqual(names)
    vi.resetModules()
    const reloaded = await import('../../src/main/model-params')
    for (const name of names) {
      expect(reloaded.getModelParams(name)).toEqual({ ...params, seed: name })
      expect(Object.hasOwn(structuredClone(reloaded.getAllModelParams()), name)).toBe(true)
    }
    const patch = { width: 512, height: 512, steps: 8, guidance: 1 }
    reloaded.applyDimensionsToModels([...names, 'toString'], patch)
    reloaded.drainPendingWrites()
    vi.resetModules()
    const applied = await import('../../src/main/model-params')
    for (const name of names) expect(applied.getModelParams(name)).toEqual({ ...params, seed: name, ...patch })
    expect(applied.getModelParams('toString')).toEqual({ ...patch, seed: '', negativePrompt: '' })
    expect(JSON.parse(fs.readFileSync(file(), 'utf8')).formatVersion).toBe(1)
    expect(setAsideCopies()).toEqual([])
  })

  it('refuses every request on a file from a newer version and leaves its bytes as they were', async () => {
    const { FORMAT_VERSIONS, NewerFormatError } = await import('../../src/main/store-format')
    const bytes = JSON.stringify({ formatVersion: FORMAT_VERSIONS.modelParams + 1, 'model.ckpt': params })
    fs.writeFileSync(file(), bytes)
    const { getModelParams, getAllModelParams, setModelParams, applyDimensionsToModels, drainPendingWrites } =
      await import('../../src/main/model-params')
    expect(() => getModelParams('model.ckpt')).toThrow(NewerFormatError)
    expect(() => getAllModelParams()).toThrow(NewerFormatError)
    expect(() => setModelParams('model.ckpt', params)).toThrow(NewerFormatError)
    expect(() => applyDimensionsToModels(['model.ckpt'], { width: 512, height: 512, steps: 8, guidance: 1 })).toThrow(NewerFormatError)
    drainPendingWrites()
    expect(fs.readFileSync(file(), 'utf8')).toBe(bytes)
  })
})
