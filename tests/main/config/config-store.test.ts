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
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    fs.rmSync(root, { recursive: true, force: true })
  })
  const file = () => path.join(root, 'config.json')
  // The sets the file holds; its format version has tests of its own.
  const stored = () => {
    const { formatVersion: _formatVersion, ...sets } = JSON.parse(fs.readFileSync(file(), 'utf8'))
    return sets
  }

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
    fs.writeFileSync(file(), JSON.stringify({ formatVersion: 1, general: { language: 'de' } }))
    const { loadConfig } = await import('../../../src/main/config/config-store')
    const defaults = createDefaultConfig()
    defaults.general.language = 'de'
    expect(loadConfig()).toEqual(defaults)
    expect(stored()).toEqual({ general: { language: 'de' } })
  })
  it('drops version and unknown keys on the next actual save', async () => {
    fs.writeFileSync(file(), JSON.stringify({ formatVersion: 1, version: 4, arbitrary: 'unknown', general: { language: 'ja' } }))
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
    fs.writeFileSync(file(), JSON.stringify({ formatVersion: 1, general: { theme: 'system' }, prompts: { slug: `${createDefaultConfig().prompts.slug}\n\n` } }))
    const { updateConfig } = await import('../../../src/main/config/config-store')
    updateConfig((draft) => { draft.general.language = 'ja' })
    expect(stored()).toEqual({ general: { language: 'ja' } })
  })
  it('writes nothing when the save equals the file', async () => {
    fs.writeFileSync(file(), JSON.stringify({ formatVersion: 1, general: { language: 'ja' } }))
    fs.utimesSync(file(), new Date(2000, 0, 1), new Date(2000, 0, 1))
    const { updateConfig } = await import('../../../src/main/config/config-store')
    updateConfig((draft) => { draft.general.language = 'ja' })
    updateConfig(() => undefined)
    expect(fs.statSync(file()).mtime.getFullYear()).toBe(2000)
    expect(fs.readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
  it('drops a rejected copy at the next save and rejects a changed set of the wrong shape', async () => {
    fs.writeFileSync(file(), JSON.stringify({ formatVersion: 1, general: { theme: 'bogus' } }))
    const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
    updateConfig((draft) => { draft.general.language = 'ja' })
    expect(stored()).toEqual({ general: { language: 'ja' } })
    expect(() => updateConfig((draft) => { (draft.general as unknown as Record<string, unknown>).auto_preview_idle_seconds = 'soon' })).toThrow('general.auto_preview_idle_seconds')
    expect(stored()).toEqual({ general: { language: 'ja' } })
    expect(loadConfig().general.language).toBe('ja')
  })
  it('reads a concurrency below one or a timeout not above zero as its built-in, and will not save one', async () => {
    const brainstorm = { ...createDefaultConfig().brainstorm, concurrency: 0 }
    fs.writeFileSync(file(), JSON.stringify({ formatVersion: 1, brainstorm, gemini: { timeout_ms: 0 }, image_backends: { flux: { concurrency: 0, timeout_ms: -1 } } }))
    const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
    const defaults = createDefaultConfig()
    expect(loadConfig().brainstorm).toEqual(defaults.brainstorm)
    expect(loadConfig().gemini.timeout_ms).toBe(defaults.gemini.timeout_ms)
    expect(loadConfig().image_backends.flux).toEqual(defaults.image_backends.flux)
    expect(() => updateConfig((draft) => { draft.openai.timeout_ms = 0 })).toThrow('openai.timeout_ms')
    updateConfig((draft) => { draft.general.language = 'ja' })
    expect(stored()).toEqual({ general: { language: 'ja' } })
  })
  it.each([['unreadable', '{ invalid'], ['not a map of sets', '[]']])('sets aside a file that is %s and starts from built-ins', async (_state, bytes) => {
    fs.writeFileSync(file(), bytes)
    const { loadConfig } = await import('../../../src/main/config/config-store')
    expect(loadConfig()).toEqual(createDefaultConfig())
    expect(fs.existsSync(file())).toBe(false)
    const invalid = fs.readdirSync(root).filter((name) => /^config-.+\.invalid$/.test(name))
    expect(invalid).toHaveLength(1)
    expect(fs.readFileSync(path.join(root, invalid[0]), 'utf8')).toBe(bytes)
  })
  it('hands out where a set-aside file went once, for the window to tell the user', async () => {
    fs.writeFileSync(file(), '{ invalid')
    const { loadConfig, drainSetAsideConfigPaths } = await import('../../../src/main/config/config-store')
    loadConfig()
    const invalid = fs.readdirSync(root).filter((name) => /^config-.+\.invalid$/.test(name))
    expect(drainSetAsideConfigPaths()).toEqual([path.join(root, invalid[0])])
    expect(drainSetAsideConfigPaths()).toEqual([])
  })
  it('halts naming the file and leaves it in place when it cannot be set aside', async () => {
    fs.writeFileSync(file(), '{ invalid')
    const { loadConfig, ConfigFileHaltError } = await import('../../../src/main/config/config-store')
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('locked') })
    let thrown: unknown
    try { loadConfig() } catch (err) { thrown = err }
    expect(thrown).toBeInstanceOf(ConfigFileHaltError)
    expect((thrown as InstanceType<typeof ConfigFileHaltError>).path).toBe(file())
    expect(((thrown as Error).cause as Error).message).toBe('locked')
    expect(fs.readFileSync(file(), 'utf8')).toBe('{ invalid')
  })
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('halts naming a file it cannot read, and leaves it unchanged in place', async () => {
    const bytes = JSON.stringify({ formatVersion: 1, general: { language: 'ja' } })
    fs.writeFileSync(file(), bytes)
    fs.chmodSync(file(), 0o000)
    const { loadConfig, ConfigFileHaltError } = await import('../../../src/main/config/config-store')
    let thrown: unknown
    try { loadConfig() } catch (err) { thrown = err }
    fs.chmodSync(file(), 0o644)
    expect(thrown).toBeInstanceOf(ConfigFileHaltError)
    expect((thrown as InstanceType<typeof ConfigFileHaltError>).path).toBe(file())
    expect(fs.readFileSync(file(), 'utf8')).toBe(bytes)
    expect(fs.readdirSync(root).filter((name) => name.endsWith('.invalid'))).toEqual([])
  })
  it('saves against the map it loaded, so a file unreadable since load is neither read, written nor set aside', async () => {
    fs.writeFileSync(file(), JSON.stringify({ formatVersion: 1, general: { language: 'ja' } }))
    fs.utimesSync(file(), new Date(2000, 0, 1), new Date(2000, 0, 1))
    const { loadConfig, updateConfig, drainSetAsideConfigPaths } = await import('../../../src/main/config/config-store')
    loadConfig()
    const read = vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw Object.assign(new Error('unreadable'), { code: 'EACCES' }) })
    updateConfig(() => undefined)
    read.mockRestore()
    expect(fs.statSync(file()).mtime.getFullYear()).toBe(2000)
    expect(stored()).toEqual({ general: { language: 'ja' } })
    expect(drainSetAsideConfigPaths()).toEqual([])
  })
  it('sets aside a file with no format version and starts from built-ins', async () => {
    const bytes = JSON.stringify({ general: { language: 'de' } })
    fs.writeFileSync(file(), bytes)
    const { loadConfig } = await import('../../../src/main/config/config-store')
    expect(loadConfig()).toEqual(createDefaultConfig())
    const invalid = fs.readdirSync(root).filter((name) => /^config-.+\.invalid$/.test(name))
    expect(invalid).toHaveLength(1)
    expect(fs.readFileSync(path.join(root, invalid[0]), 'utf8')).toBe(bytes)
  })
  it('writes its format version first and reads it back', async () => {
    const { updateConfig } = await import('../../../src/main/config/config-store')
    const { FORMAT_VERSIONS } = await import('../../../src/main/store-format')
    updateConfig((draft) => { draft.general.language = 'ja' })
    expect(Object.entries(JSON.parse(fs.readFileSync(file(), 'utf8')))[0]).toEqual(['formatVersion', FORMAT_VERSIONS.config])
    vi.resetModules()
    const reloaded = await import('../../../src/main/config/config-store')
    expect(reloaded.loadConfig().general.language).toBe('ja')
  })
  it('halts on a file from a newer version, naming it, and leaves its bytes as they were', async () => {
    const { FORMAT_VERSIONS, NewerFormatError } = await import('../../../src/main/store-format')
    const bytes = JSON.stringify({ formatVersion: FORMAT_VERSIONS.config + 1, general: { language: 'ja' } })
    fs.writeFileSync(file(), bytes)
    const { loadConfig } = await import('../../../src/main/config/config-store')
    let thrown: unknown
    try { loadConfig() } catch (err) { thrown = err }
    expect(thrown).toBeInstanceOf(NewerFormatError)
    expect((thrown as InstanceType<typeof NewerFormatError>).path).toBe(file())
    expect(fs.readFileSync(file(), 'utf8')).toBe(bytes)
    expect(fs.readdirSync(root).filter((name) => name.endsWith('.invalid'))).toEqual([])
  })
  it('sets aside a file whose format version is not a positive integer', async () => {
    fs.writeFileSync(file(), JSON.stringify({ formatVersion: 'one', general: { language: 'ja' } }))
    const { loadConfig } = await import('../../../src/main/config/config-store')
    expect(loadConfig()).toEqual(createDefaultConfig())
    expect(fs.readdirSync(root).filter((name) => /^config-.+\.invalid$/.test(name))).toHaveLength(1)
  })
  it('warns once, naming the key, for a set that fails its check', async () => {
    const log = vi.fn()
    vi.doMock('../../../src/main/logger', async (importOriginal) => ({ ...await importOriginal<object>(), log }))
    fs.writeFileSync(file(), JSON.stringify({ formatVersion: 1, general: { theme: 'bogus' } }))
    try {
      const { loadConfig } = await import('../../../src/main/config/config-store')
      loadConfig()
    } finally {
      vi.doUnmock('../../../src/main/logger')
    }
    expect(log.mock.calls.filter(([level]) => level === 'warn')).toEqual([['warn', 'Invalid config set; using built-in', { key: 'general.theme' }]])
  })
  it('keeps every built-in text in its cleaned form', async () => {
    const { configSetDefaults, cleanConfigSet } = await import('../../../src/main/config/config-sets')
    for (const [key, builtIn] of Object.entries(configSetDefaults())) expect(cleanConfigSet(key, builtIn), key).toEqual(builtIn)
  })
  it('rejects an incomplete cluster as absent without repairing or quarantining the file', async () => {
    fs.writeFileSync(file(), JSON.stringify({ formatVersion: 1, brainstorm: { concurrency: 2 }, general: { theme: 'bogus' } }))
    const { loadConfig } = await import('../../../src/main/config/config-store')
    expect(loadConfig()).toEqual(createDefaultConfig())
    expect(stored()).toEqual({ brainstorm: { concurrency: 2 }, general: { theme: 'bogus' } })
  })
  it('writes the file from the config in memory, not from a set changed on disk since load', async () => {
    const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
    loadConfig()
    fs.writeFileSync(file(), JSON.stringify({ formatVersion: 1, general: { language: 'ja' } }))
    updateConfig((draft) => { draft.notifications.sounds_enabled = false })
    expect(stored()).toEqual({ notifications: { sounds_enabled: false } })
  })
  // Which parameters a model takes is the column's to judge, so a record saved
  // before a field was added or removed (v0.1.0's moderation) still loads whole.
  it('loads an image column\'s saved model and parameters whatever fields they carry', async () => {
    const saved = { model: 'gpt-image-1.5', default_params: { width: 1024, height: 1024, moderation: 'auto', quality: 'high', outputFormat: 'png', background: 'opaque' } }
    fs.writeFileSync(file(), JSON.stringify({ formatVersion: 1, image_backends: { openai: { defaults: saved } } }))
    const { loadConfig } = await import('../../../src/main/config/config-store')
    expect(loadConfig().image_backends.openai.model).toBe('gpt-image-1.5')
    expect(loadConfig().image_backends.openai.default_params).toEqual(saved.default_params)
  })
  it('refuses an image column\'s saved parameters that are not plain values', async () => {
    fs.writeFileSync(file(), JSON.stringify({ formatVersion: 1, image_backends: { openai: { defaults: { model: 'x', default_params: { width: { nested: 1 } } } } } }))
    const { loadConfig } = await import('../../../src/main/config/config-store')
    expect(loadConfig().image_backends.openai).toEqual(createDefaultConfig().image_backends.openai)
  })
  it('stores model and parameters in one renamed set without migrating old sibling keys', async () => {
    fs.writeFileSync(file(), JSON.stringify({ formatVersion: 1, image_backends: { openai: { model: 'old', default_params: {}, concurrency: 1 } } }))
    const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
    expect(loadConfig().image_backends.openai.model).toBe(createDefaultConfig().image_backends.openai.model)
    updateConfig((draft) => { draft.image_backends.openai.model = 'chosen' })
    expect(stored()).toEqual({ image_backends: { openai: {
      concurrency: 1,
      defaults: { model: 'chosen', default_params: createDefaultConfig().image_backends.openai.default_params },
    } } })
  })
})
