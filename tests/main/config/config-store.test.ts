import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultConfig } from '../../../src/main/config/defaults'

// The security property behind keys living outside the config type: the shipped
// config shape has nowhere to PUT a key, so config.json is key-free by
// construction rather than by a scrub list somebody must extend when a provider
// is added. A key reaching that file would be copied into the add-only backup
// history, which has no prune path to retract it.
//
// This asserts against the default config object rather than the written file on
// purpose: the written file is also swept by dropLegacyConfigKeys, so a test
// reading it would still pass with this property broken.
describe('the config shape cannot carry an api key', () => {
  function apiKeyPaths(value: unknown, trail: string[] = []): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    return Object.entries(value).flatMap(([key, child]) =>
      key === 'api_key'
        ? [[...trail, key].join('.')]
        : apiKeyPaths(child, [...trail, key])
    )
  }

  it('has no api_key field anywhere in the shipped defaults', () => {
    expect(apiKeyPaths(createDefaultConfig())).toEqual([])
  })
})

describe('settings by set', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-config-'))
    vi.stubEnv('IMAGEQUEUE_DATA_DIR', root)
    vi.resetModules()
  })
  afterEach(async () => {
    const { closeBackupStore } = await import('../../../src/main/backup/backup-store')
    closeBackupStore()
    vi.unstubAllEnvs()
    fs.rmSync(root, { recursive: true, force: true })
  })
  const file = () => path.join(root, 'config.json')
  const stored = () => JSON.parse(fs.readFileSync(file(), 'utf8'))

  it('loads built-ins without writing on first run', async () => {
    const { loadConfig } = await import('../../../src/main/config/config-store')
    expect(loadConfig()).toEqual(createDefaultConfig())
    expect(fs.existsSync(file())).toBe(false)
  })
  it('writes exactly one changed scalar set', async () => {
    const { updateConfig } = await import('../../../src/main/config/config-store')
    updateConfig((draft) => { draft.general.language = 'ja' })
    expect(stored()).toEqual({ general: { language: 'ja' } })
  })
  it('reads every other set from the built-in without materializing it', async () => {
    fs.writeFileSync(file(), JSON.stringify({ general: { language: 'de' } }))
    const { loadConfig } = await import('../../../src/main/config/config-store')
    const defaults = createDefaultConfig()
    defaults.general.language = 'de'
    expect(loadConfig()).toEqual(defaults)
    expect(stored()).toEqual({ general: { language: 'de' } })
  })
  it('drops version and unknown keys on the next actual save', async () => {
    fs.writeFileSync(file(), JSON.stringify({ version: 4, arbitrary: 'unknown', general: { language: 'ja' } }))
    const { updateConfig } = await import('../../../src/main/config/config-store')
    updateConfig((draft) => { draft.notifications.sounds_enabled = false })
    expect(stored()).toEqual({ general: { language: 'ja' }, notifications: { sounds_enabled: false } })
  })
  it('does not write on an unchanged save', async () => {
    const { updateConfig } = await import('../../../src/main/config/config-store')
    updateConfig(() => undefined)
    expect(fs.existsSync(file())).toBe(false)
  })
  it('keeps a whole cluster, and resets by deleting its copy', async () => {
    const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
    updateConfig((draft) => { draft.brainstorm.concurrency = 2 })
    expect(stored()).toEqual({ brainstorm: { ...createDefaultConfig().brainstorm, concurrency: 2 } })
    updateConfig(() => undefined, ['brainstorm'])
    expect(stored()).toEqual({})
    expect(loadConfig().brainstorm).toEqual(createDefaultConfig().brainstorm)
  })
  it('rejects an incomplete cluster as absent without repairing or quarantining the file', async () => {
    fs.writeFileSync(file(), JSON.stringify({ brainstorm: { concurrency: 2 }, general: { theme: 'bogus' } }))
    const { loadConfig } = await import('../../../src/main/config/config-store')
    expect(loadConfig()).toEqual(createDefaultConfig())
    expect(stored()).toEqual({ brainstorm: { concurrency: 2 }, general: { theme: 'bogus' } })
  })
  it('re-reads the map and keeps a different set changed since load', async () => {
    const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
    loadConfig()
    fs.writeFileSync(file(), JSON.stringify({ general: { language: 'ja' } }))
    updateConfig((draft) => { draft.notifications.sounds_enabled = false })
    expect(stored()).toEqual({ general: { language: 'ja' }, notifications: { sounds_enabled: false } })
  })
  it('stores model and parameters in one renamed set without migrating old sibling keys', async () => {
    fs.writeFileSync(file(), JSON.stringify({ image_backends: { openai: { model: 'old', default_params: {}, concurrency: 1 } } }))
    const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
    expect(loadConfig().image_backends.openai.model).toBe(createDefaultConfig().image_backends.openai.model)
    updateConfig((draft) => { draft.image_backends.openai.model = 'chosen' })
    expect(stored()).toEqual({ image_backends: { openai: {
      concurrency: 1,
      defaults: { model: 'chosen', default_params: createDefaultConfig().image_backends.openai.default_params },
    } } })
  })
})
