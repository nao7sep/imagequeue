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
    api.loadBackendParams()
    expect(api.getBackendParams().grok).toEqual({ model: getDefaultModelForBackend('grok').id, params: IMAGE_DEFAULT_PARAMS.grok })
    expect(fs.existsSync(file())).toBe(false)
  })

  it('saves the latest edit of each column once, after the last edit', async () => {
    api.loadBackendParams()
    vi.useFakeTimers()
    const first = api.saveBackendParams('openai', 'a', { width: 1 })
    const params = { width: 2 }
    const last = api.saveBackendParams('openai', 'b', params)
    params.width = 9
    const other = api.saveBackendParams('flux', 'flux', { width: 3 })
    expect(fs.existsSync(file())).toBe(false)
    await vi.advanceTimersByTimeAsync(800)
    await Promise.all([first, last, other])
    expect(stored()).toEqual({ formatVersion: 1, backends: { openai: { model: 'b', params: { width: 2 } }, flux: { model: 'flux', params: { width: 3 } } } })
  })

  it('reads an entry that is not plain values as absent, and keeps it until that column saves', async () => {
    const bad = { model: 'x', params: { width: { nested: 1 } } }
    fs.writeFileSync(file(), JSON.stringify({ formatVersion: 1, later: true, backends: { openai: bad, grok: { model: 'g', params: { quality: 'low' } }, future: 1 } }))
    const { getDefaultModelForBackend } = await import('../../src/shared/ai-models')
    api.loadBackendParams()
    expect(api.getBackendParams().openai.model).toBe(getDefaultModelForBackend('openai').id)
    expect(api.getBackendParams().grok).toEqual({ model: 'g', params: { quality: 'low' } })
    const saved = api.saveBackendParams('grok', 'g', { quality: 'auto' })
    await api.drainBackendParams()
    await saved
    expect(stored()).toEqual({ formatVersion: 1, later: true, backends: { openai: bad, grok: { model: 'g', params: { quality: 'auto' } }, future: 1 } })
    const replaced = api.saveBackendParams('openai', 'o', {})
    await api.drainBackendParams()
    await replaced
    expect((stored().backends as Record<string, unknown>).openai).toEqual({ model: 'o', params: {} })
  })

  it('refuses a save whose parameters are not plain values', async () => {
    api.loadBackendParams()
    await expect(api.saveBackendParams('openai', 'o', { width: { nested: 1 } })).rejects.toThrow('invalid')
  })

  // The fields' own rules: the column shows a saved number as it is, so one its
  // field would not accept is refused here instead of corrected there.
  it('reads an entry with a number its field would not accept as absent, keeps it, and refuses to save one', async () => {
    const { getDefaultModelForBackend } = await import('../../src/shared/ai-models')
    const flex = { model: 'flux-2-flex', params: { steps: 51, guidance: 5 } }
    const openai = { model: 'gpt-image-2', params: { width: 1000, height: 1024 } }
    fs.writeFileSync(file(), JSON.stringify({ formatVersion: 1, backends: { flux: flex, openai } }))
    api.loadBackendParams()
    const { IMAGE_DEFAULT_PARAMS } = await import('../../src/shared/image-backend-defaults')
    expect(api.getBackendParams().flux).toEqual({ model: getDefaultModelForBackend('flux').id, params: IMAGE_DEFAULT_PARAMS.flux })
    expect(api.getBackendParams().openai).toEqual({ model: getDefaultModelForBackend('openai').id, params: IMAGE_DEFAULT_PARAMS.openai })
    await expect(api.saveBackendParams('flux', 'flux-2-flex', { steps: 50, guidance: 1 })).rejects.toThrow('invalid')
    await expect(api.saveBackendParams('openai', 'gpt-image-2', { width: 1024, height: 1024, outputCompression: 100.5 })).rejects.toThrow('invalid')
    await api.saveBackendParams('openai', 'gpt-image-2', { width: 1040, height: 1024 })
    await api.drainBackendParams()
    expect(stored()).toEqual({ formatVersion: 1, backends: { flux: flex, openai: { model: 'gpt-image-2', params: { width: 1040, height: 1024 } } } })
  })

  it.each([
    ['text that is not JSON', '{ "backends": '],
    ['no format version', JSON.stringify({ backends: {} })],
    ['no backend map', JSON.stringify({ formatVersion: 1, backends: [] })],
  ])('sets aside a file with %s and starts every column from its built-in', async (_case, bytes) => {
    fs.writeFileSync(file(), bytes)
    api.loadBackendParams()
    const [copy] = fs.readdirSync(root).filter((name) => /^backend-params-\d{8}-\d{6}-utc\.invalid$/.test(name))
    expect(fs.readFileSync(path.join(root, copy), 'utf8')).toBe(bytes)
    expect(api.drainSetAsideBackendParamsPaths()).toEqual([path.join(root, copy)])
    expect(fs.existsSync(file())).toBe(false)
  })

  it('stops at a file written by a newer build and leaves it as it is', async () => {
    const bytes = JSON.stringify({ formatVersion: 99, backends: {} })
    fs.writeFileSync(file(), bytes)
    let error: unknown
    try { api.loadBackendParams() } catch (thrown) { error = thrown }
    expect(error).toMatchObject({ name: 'NewerFormatError' })
    expect(fs.readFileSync(file(), 'utf8')).toBe(bytes)
  })

  it('reports a save failure and keeps the edit for quit Retry', async () => {
    api.loadBackendParams()
    fs.mkdirSync(file())
    const save = api.saveBackendParams('openai', 'a', { width: 1 })
    await expect(api.drainBackendParams()).rejects.toThrow()
    await expect(save).rejects.toThrow()
    fs.rmdirSync(file())
    await api.drainBackendParams()
    expect(stored()).toEqual({ formatVersion: 1, backends: { openai: { model: 'a', params: { width: 1 } } } })
  })
})
