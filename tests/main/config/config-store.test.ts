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
// purpose: the written file holds only declared sets, so a test
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
  it('keeps a whole cluster, and a save back to the built-in leaves an empty file', async () => {
    const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
    updateConfig((draft) => { draft.brainstorm.concurrency = 2 })
    expect(stored()).toEqual({ brainstorm: { ...createDefaultConfig().brainstorm, concurrency: 2 } })
    updateConfig((draft) => { draft.brainstorm = createDefaultConfig().brainstorm })
    expect(stored()).toEqual({})
    expect(loadConfig().brainstorm).toEqual(createDefaultConfig().brainstorm)
  })
  it('removes a key saved back to its built-in and keeps the others', async () => {
    const { updateConfig } = await import('../../../src/main/config/config-store')
    updateConfig((draft) => { draft.general.language = 'ja'; draft.notifications.sounds_enabled = false })
    updateConfig((draft) => { draft.general.language = 'system' })
    expect(stored()).toEqual({ notifications: { sounds_enabled: false } })
  })
  it('stores nothing for a text that differs from its built-in only in line endings or trailing spaces', async () => {
    const { updateConfig } = await import('../../../src/main/config/config-store')
    const slug = createDefaultConfig().prompts.slug
    updateConfig((draft) => { draft.prompts.slug = `${slug.replace(/\n/g, '  \r\n')}\r\n` })
    updateConfig((draft) => { draft.brainstorm.templates.expansion = `${createDefaultConfig().brainstorm.templates.expansion} \r\n` })
    expect(fs.existsSync(file())).toBe(false)
  })
  it('compares a model id trimmed and case-insensitive, and stores a different one cleaned', async () => {
    const { updateConfig } = await import('../../../src/main/config/config-store')
    updateConfig((draft) => { draft.gemini.slug = ` ${createDefaultConfig().gemini.slug.toUpperCase()} ` })
    expect(fs.existsSync(file())).toBe(false)
    updateConfig((draft) => { draft.gemini.slug = '  my-model  ' })
    expect(stored()).toEqual({ gemini: { slug: 'my-model' } })
  })
  it('stores a path exactly as given', async () => {
    const { updateConfig } = await import('../../../src/main/config/config-store')
    updateConfig((draft) => { draft.general.export_dir = '/tmp/exports ' })
    updateConfig((draft) => { draft.image_backends.drawthings.models_dir = ' /tmp/models' })
    expect(stored()).toEqual({ general: { export_dir: '/tmp/exports ' }, image_backends: { drawthings: { models_dir: ' /tmp/models' } } })
  })
  it('drops an untouched copy equal to its built-in at the next save of another set', async () => {
    fs.writeFileSync(file(), JSON.stringify({ general: { theme: 'system' }, prompts: { slug: `${createDefaultConfig().prompts.slug}\n\n` } }))
    const { updateConfig } = await import('../../../src/main/config/config-store')
    updateConfig((draft) => { draft.general.language = 'ja' })
    expect(stored()).toEqual({ general: { language: 'ja' } })
  })
  it('writes nothing when the save equals the file', async () => {
    fs.writeFileSync(file(), JSON.stringify({ general: { language: 'ja' } }))
    fs.utimesSync(file(), new Date(2000, 0, 1), new Date(2000, 0, 1))
    const { updateConfig } = await import('../../../src/main/config/config-store')
    updateConfig((draft) => { draft.general.language = 'ja' })
    updateConfig(() => undefined)
    expect(fs.statSync(file()).mtime.getFullYear()).toBe(2000)
    expect(fs.readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
  it('keeps an unchanged rejected copy and rejects a changed set of the wrong shape', async () => {
    fs.writeFileSync(file(), JSON.stringify({ general: { theme: 'bogus' } }))
    const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
    updateConfig((draft) => { draft.general.language = 'ja' })
    expect(stored()).toEqual({ general: { theme: 'bogus', language: 'ja' } })
    expect(() => updateConfig((draft) => { (draft.general as unknown as Record<string, unknown>).auto_preview_idle_seconds = 'soon' })).toThrow('general.auto_preview_idle_seconds')
    expect(stored()).toEqual({ general: { theme: 'bogus', language: 'ja' } })
    expect(loadConfig().general.language).toBe('ja')
  })
  it('keeps every built-in text in its cleaned form', async () => {
    const { configSetDefaults, cleanConfigSet } = await import('../../../src/main/config/config-sets')
    for (const [key, builtIn] of Object.entries(configSetDefaults())) expect(cleanConfigSet(key, builtIn), key).toEqual(builtIn)
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
