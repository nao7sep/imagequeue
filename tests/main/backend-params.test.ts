import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}))

// The store reads backend-params.json once per process, so each test starts a fresh module.
describe('backend-params.json', () => {
  let root: string
  const file = () => path.join(root, 'backend-params.json')
  const config = () => path.join(root, 'config.json')
  const stored = () => JSON.parse(fs.readFileSync(file(), 'utf8')) as Record<string, unknown>
  let api: typeof import('../../src/main/backend-params')
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-backend-params-'))
    vi.stubEnv('IMAGEQUEUE_DATA_DIR', root)
    vi.resetModules()
    api = await import('../../src/main/backend-params')
  })
  afterEach(async () => {
    vi.useRealTimers()
    const { closeBackupStore } = await import('../../src/main/backup/backup-store')
    await closeBackupStore()
    vi.unstubAllEnvs()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('starts every column from its built-in model and parameters, writing nothing', async () => {
    const { getDefaultModelForBackend } = await import('../../src/shared/ai-models')
    const { IMAGE_DEFAULT_PARAMS } = await import('../../src/shared/image-backend-defaults')
    await api.loadBackendParams()
    expect(api.getImageBackendDefaults().grok).toEqual({ model: getDefaultModelForBackend('grok').id, params: IMAGE_DEFAULT_PARAMS.grok })
    expect(fs.existsSync(file())).toBe(false)
  })

  it('moves what config.json holds for the columns once, and config.json drops it', async () => {
    fs.writeFileSync(config(), JSON.stringify({
      formatVersion: 1,
      general: { language: 'ja' },
      image_backends: { openai: { concurrency: 1, defaults: { model: 'gpt-image-1.5', default_params: { width: 512, moderation: 'auto' } } } },
    }))
    await api.loadBackendParams()
    expect(stored()).toEqual({ formatVersion: 1, backends: { openai: { model: 'gpt-image-1.5', params: { width: 512, moderation: 'auto' } } } })
    expect(api.getImageBackendDefaults().openai).toEqual({ model: 'gpt-image-1.5', params: { width: 512, moderation: 'auto' } })
    expect(JSON.parse(fs.readFileSync(config(), 'utf8'))).toEqual({ formatVersion: 1, general: { language: 'ja' }, image_backends: { openai: { concurrency: 1 } } })

    // The next launch reads the new file and moves nothing again.
    vi.resetModules()
    fs.writeFileSync(config(), JSON.stringify({ formatVersion: 1, image_backends: { openai: { defaults: { model: 'stale', default_params: {} } } } }))
    api = await import('../../src/main/backend-params')
    await api.loadBackendParams()
    expect(api.getImageBackendDefaults().openai.model).toBe('gpt-image-1.5')
  })

  it('saves the latest edit of each column once, after the last edit', async () => {
    await api.loadBackendParams()
    vi.useFakeTimers()
    const first = api.saveImageBackendDefaults('openai', 'a', { width: 1 })
    const params = { width: 2 }
    const last = api.saveImageBackendDefaults('openai', 'b', params)
    params.width = 9
    const other = api.saveImageBackendDefaults('flux', 'flux', { width: 3 })
    expect(fs.existsSync(file())).toBe(false)
    await vi.advanceTimersByTimeAsync(800)
    await Promise.all([first, last, other])
    expect(stored()).toEqual({ formatVersion: 1, backends: { openai: { model: 'b', params: { width: 2 } }, flux: { model: 'flux', params: { width: 3 } } } })
  })

  it('reads an entry that is not plain values as absent, and keeps it until that column saves', async () => {
    const bad = { model: 'x', params: { width: { nested: 1 } } }
    fs.writeFileSync(file(), JSON.stringify({ formatVersion: 1, later: true, backends: { openai: bad, grok: { model: 'g', params: { quality: 'low' } }, future: 1 } }))
    const { getDefaultModelForBackend } = await import('../../src/shared/ai-models')
    await api.loadBackendParams()
    expect(api.getImageBackendDefaults().openai.model).toBe(getDefaultModelForBackend('openai').id)
    expect(api.getImageBackendDefaults().grok).toEqual({ model: 'g', params: { quality: 'low' } })
    const saved = api.saveImageBackendDefaults('grok', 'g', { quality: 'auto' })
    await api.drainBackendDefaults()
    await saved
    expect(stored()).toEqual({ formatVersion: 1, later: true, backends: { openai: bad, grok: { model: 'g', params: { quality: 'auto' } }, future: 1 } })
    const replaced = api.saveImageBackendDefaults('openai', 'o', {})
    await api.drainBackendDefaults()
    await replaced
    expect((stored().backends as Record<string, unknown>).openai).toEqual({ model: 'o', params: {} })
  })

  it('refuses a save whose parameters are not plain values', async () => {
    await api.loadBackendParams()
    await expect(api.saveImageBackendDefaults('openai', 'o', { width: { nested: 1 } })).rejects.toThrow('invalid')
  })

  it.each([
    ['text that is not JSON', '{ "backends": '],
    ['no format version', JSON.stringify({ backends: {} })],
    ['no backend map', JSON.stringify({ formatVersion: 1, backends: [] })],
  ])('sets aside a file with %s and starts every column from its built-in', async (_case, bytes) => {
    fs.writeFileSync(file(), bytes)
    await api.loadBackendParams()
    const [copy] = fs.readdirSync(root).filter((name) => /^backend-params-\d{8}-\d{6}-utc\.invalid$/.test(name))
    expect(fs.readFileSync(path.join(root, copy), 'utf8')).toBe(bytes)
    expect(api.drainSetAsideBackendParamsPaths()).toEqual([path.join(root, copy)])
    expect(fs.existsSync(file())).toBe(false)
  })

  it('stops at a file written by a newer build and leaves it as it is', async () => {
    const bytes = JSON.stringify({ formatVersion: 99, backends: {} })
    fs.writeFileSync(file(), bytes)
    await expect(api.loadBackendParams()).rejects.toMatchObject({ name: 'NewerFormatError' })
    expect(fs.readFileSync(file(), 'utf8')).toBe(bytes)
  })

  it('reports a save failure and keeps the edit for quit Retry', async () => {
    await api.loadBackendParams()
    fs.mkdirSync(file())
    const save = api.saveImageBackendDefaults('openai', 'a', { width: 1 })
    await expect(api.drainBackendDefaults()).rejects.toThrow()
    await expect(save).rejects.toThrow()
    fs.rmdirSync(file())
    await api.drainBackendDefaults()
    expect(stored()).toEqual({ formatVersion: 1, backends: { openai: { model: 'a', params: { width: 1 } } } })
  })
})
