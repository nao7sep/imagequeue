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

  it('reads a file with no format version as version 1', async () => {
    fs.writeFileSync(file(), JSON.stringify({ 'model.ckpt': params }))
    const { getModelParams, getAllModelParams } = await import('../../src/main/model-params')
    expect(getModelParams('model.ckpt')).toEqual(params)
    expect(getAllModelParams()).toEqual({ 'model.ckpt': params })
  })

  it('writes its format version first and reads it back', async () => {
    const { FORMAT_VERSIONS } = await import('../../src/main/store-format')
    const { setModelParams, drainPendingWrites } = await import('../../src/main/model-params')
    setModelParams('model.ckpt', params)
    drainPendingWrites()
    expect(Object.entries(JSON.parse(fs.readFileSync(file(), 'utf8')))).toEqual([
      ['formatVersion', FORMAT_VERSIONS.modelParams],
      ['model.ckpt', params],
    ])
    vi.resetModules()
    const reloaded = await import('../../src/main/model-params')
    expect(reloaded.getAllModelParams()).toEqual({ 'model.ckpt': params })
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
