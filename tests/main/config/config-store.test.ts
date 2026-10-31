import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultConfig } from '../../../src/main/config/defaults'
import { BRAINSTORM_LIMITS } from '../../../src/shared/brainstorm-config'
import { header } from '../file-header'
import { FILE_FORMATS } from '../../../src/main/store-format'

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

  it('has no api_key field anywhere in the shipped defaults', async () => {
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
  // The sets the file holds; its file header has tests of its own.
  const stored = () => {
    const { format: _format, writer: _writer, ...sets } = JSON.parse(fs.readFileSync(file(), 'utf8'))
    return sets
  }

  it('preserves unknown literal and prototype-like members without interpreting paths', async () => {
    const raw = JSON.parse('{"format":{"owner":"imagequeue","kind":"config","version":1},"__proto__":{"reviewMarker":true},"__proto__.reviewMarker":"literal","general.theme":"literal theme","general":{"future.option":42,"constructor":{"prototype":{"reviewMarker":true}}}}')
    fs.writeFileSync(file(), JSON.stringify(raw))
    const { updateConfig } = await import('../../../src/main/config/config-store')
    await updateConfig((draft) => { draft.general.language = 'ja' })
    const saved = stored()
    expect(Object.prototype).not.toHaveProperty('reviewMarker')
    expect(saved.__proto__).toEqual(raw.__proto__)
    expect(Object.hasOwn(saved, '__proto__')).toBe(true)
    expect(saved['__proto__.reviewMarker']).toBe('literal')
    expect(saved['general.theme']).toBe('literal theme')
    expect(saved.general['future.option']).toBe(42)
    expect(saved.general.constructor).toEqual(raw.general.constructor)
  })

  it('cleans declared template text while carrying unknown members unchanged', async () => {
    const brainstorm = createDefaultConfig().brainstorm
    const templates = { ...brainstorm.templates, future: 42 }
    const format_directives = { ...brainstorm.format_directives, future: { enabled: true }, formats: { ...brainstorm.format_directives.formats, future: 17 } }
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.config), brainstorm: { templates, format_directives } }))
    const { updateConfig } = await import('../../../src/main/config/config-store')
    await updateConfig((draft) => { draft.general.language = 'ja' })
    expect(stored().brainstorm.templates.future).toBe(42)
    expect(stored().brainstorm.format_directives.future).toEqual({ enabled: true })
    expect(stored().brainstorm.format_directives.formats.future).toBe(17)
  })

  it('loads built-ins without writing on first run', async () => {
    const { loadConfig } = await import('../../../src/main/config/config-store')
    expect(loadConfig()).toEqual(createDefaultConfig())
    expect(fs.existsSync(file())).toBe(false)
  })
  it('uses the established root without synchronous filesystem work during runtime', async () => {
    const { loadConfig, getDataDir, getConfigPath, updateConfig } = await import('../../../src/main/config/config-store')
    loadConfig()
    const { hasApiKey, refreshApiKeys } = await import('../../../src/main/config/api-keys-store')
    vi.stubEnv('OPENAI_IMAGE_API_KEY', '')
    await refreshApiKeys()
    const { listElaborators, createElaborator } = await import('../../../src/main/elaborators')
    listElaborators()
    const forbidden = (): never => { throw new Error('synchronous root I/O during runtime') }
    const mkdir = vi.spyOn(fs, 'mkdirSync').mockImplementation(forbidden)
    const stat = vi.spyOn(fs, 'statSync').mockImplementation(forbidden)
    try {
      expect(getDataDir()).toBe(root)
      expect(getConfigPath()).toBe(file())
      expect(hasApiKey('openai.image')).toBe(false)
      await updateConfig((draft) => { draft.general.language = 'ja' })
      await createElaborator({ kind: 'style', name: 'Runtime root probe', template: 'plain background' })
      expect(loadConfig().general.language).toBe('ja')
    } finally { mkdir.mockRestore(); stat.mockRestore() }
  })
  it('applies a later edit at once and writes it behind physical publication', async () => {
    const { updateConfig, loadConfig } = await import('../../../src/main/config/config-store')
    loadConfig()
    const renameOriginal = fs.promises.rename.bind(fs.promises)
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const held = new Promise<void>((resolve) => { release = resolve })
    vi.spyOn(fs.promises, 'rename').mockImplementationOnce(async (...args) => {
      entered()
      await held
      await renameOriginal(...args)
    })
    const first = updateConfig((draft) => { draft.general.language = 'ja' })
    await started
    let appliedSecond = false
    const second = updateConfig((draft) => { appliedSecond = true; draft.notifications.notifications_enabled = false })
    await Promise.resolve()
    // Both apply when accepted; the second write waits behind the first.
    expect(appliedSecond).toBe(true)
    expect(loadConfig()).toMatchObject({ general: { language: 'ja' }, notifications: { notifications_enabled: false } })
    release()
    await Promise.all([first, second])
    expect(stored()).toMatchObject({ general: { language: 'ja' }, notifications: { notifications_enabled: false } })
  })
  it('retries failed physical save intent before applying a later unrelated edit', async () => {
    const { updateConfig, retryConfigSaves } = await import('../../../src/main/config/config-store')
    vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(updateConfig((draft) => { draft.general.language = 'ja' })).rejects.toThrow('disk unavailable')
    await updateConfig((draft) => { draft.notifications.notifications_enabled = false })
    await retryConfigSaves()
    expect(stored()).toMatchObject({ general: { language: 'ja' }, notifications: { notifications_enabled: false } })
  })
  it('writes exactly one changed scalar set', async () => {
    const { updateConfig } = await import('../../../src/main/config/config-store')
    await updateConfig((draft) => { draft.general.language = 'ja' })
    expect(stored()).toEqual({ general: { language: 'ja' } })
  })
  it('reads every other set from the built-in without materializing it', async () => {
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.config), general: { language: 'de' } }))
    const { loadConfig } = await import('../../../src/main/config/config-store')
    const defaults = createDefaultConfig()
    defaults.general.language = 'de'
    expect(loadConfig()).toEqual(defaults)
    expect(stored()).toEqual({ general: { language: 'de' } })
  })
  it('keeps keys it does not know, top-level and within its own sections, on the next save', async () => {
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.config), version: 4, arbitrary: 'unknown', general: { language: 'ja', later_option: [1] } }))
    const { updateConfig } = await import('../../../src/main/config/config-store')
    await updateConfig((draft) => { draft.notifications.notifications_enabled = false })
    expect(stored()).toEqual({
      version: 4, arbitrary: 'unknown', general: { language: 'ja', later_option: [1] }, notifications: { notifications_enabled: false },
    })
  })
  it('does not write on an unchanged save', async () => {
    const { updateConfig } = await import('../../../src/main/config/config-store')
    await updateConfig(() => undefined)
    expect(fs.existsSync(file())).toBe(false)
  })
  it('a save back to the built-in leaves an empty file', async () => {
    const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
    const defaults = createDefaultConfig().image_backends.openai
    await updateConfig((draft) => { draft.image_backends.openai.concurrency = 1 })
    expect(stored()).toEqual({ image_backends: { openai: { concurrency: 1 } } })
    await updateConfig((draft) => { draft.image_backends.openai = createDefaultConfig().image_backends.openai })
    expect(stored()).toEqual({})
    expect(loadConfig().image_backends.openai).toEqual(defaults)
  })
  it('stores each brainstorm value as its own set', async () => {
    const { updateConfig } = await import('../../../src/main/config/config-store')
    await updateConfig((draft) => { draft.brainstorm.concurrency = 2 })
    expect(stored()).toEqual({ brainstorm: { concurrency: 2 } })
  })
  it('reads the templates of a brainstorm set stored whole', async () => {
    const brainstorm = { ...createDefaultConfig().brainstorm, concurrency: 4, templates: { expansion: 'My expansion {{N}}' } }
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.config), brainstorm }))
    const { loadConfig } = await import('../../../src/main/config/config-store')
    expect(loadConfig().brainstorm).toEqual(brainstorm)
  })
  it('keeps the brainstorm templates in effect beside a brainstorm number that fails its check', async () => {
    const brainstorm = { ...createDefaultConfig().brainstorm, batch_size: 'ten', templates: { expansion: 'My expansion {{N}}' } }
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.config), brainstorm }))
    const { loadConfig } = await import('../../../src/main/config/config-store')
    expect(loadConfig().brainstorm.templates.expansion).toBe('My expansion {{N}}')
    expect(loadConfig().brainstorm.batch_size).toBe(createDefaultConfig().brainstorm.batch_size)
  })
  // A save the user does not see as a setting: closing the preview window.
  it.each([
    ['closing the preview window', (draft: ReturnType<typeof createDefaultConfig>) => { draft.general.show_preview_window = false }],
  ])('keeps a rejected brainstorm template and an unknown key through %s', async (_save, apply) => {
    const sets = { brainstorm: { templates: { expansion: 42 } }, general: { show_preview_window: true }, later: { kept: true } }
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.config), ...sets }))
    const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
    expect(loadConfig().brainstorm.templates).toEqual(createDefaultConfig().brainstorm.templates)
    await updateConfig(apply)
    expect(stored()).toMatchObject({ brainstorm: { templates: { expansion: 42 } }, later: { kept: true } })
  })
  it('replaces a rejected copy once the user changes that set', async () => {
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.config), brainstorm: { templates: { expansion: 42 } } }))
    const { updateConfig } = await import('../../../src/main/config/config-store')
    await updateConfig((draft) => { draft.brainstorm.templates.expansion = 'Fresh {{N}}' })
    expect(stored()).toEqual({ brainstorm: { templates: { expansion: 'Fresh {{N}}' } } })
  })
  it('removes a key saved back to its built-in and keeps the others', async () => {
    const { updateConfig } = await import('../../../src/main/config/config-store')
    await updateConfig((draft) => { draft.general.language = 'ja'; draft.notifications.notifications_enabled = false })
    await updateConfig((draft) => { draft.general.language = 'system' })
    expect(stored()).toEqual({ notifications: { notifications_enabled: false } })
  })
  it('stores nothing for a text that differs from its built-in only in line endings or trailing spaces', async () => {
    const { updateConfig } = await import('../../../src/main/config/config-store')
    const slug = createDefaultConfig().prompts.slug
    await updateConfig((draft) => { draft.prompts.slug = `${slug.replace(/\n/g, '  \r\n')}\r\n` })
    await updateConfig((draft) => { draft.brainstorm.templates.expansion = `${createDefaultConfig().brainstorm.templates.expansion} \r\n` })
    expect(fs.existsSync(file())).toBe(false)
  })
  it('compares a model id trimmed and case-insensitive, and stores a different one cleaned', async () => {
    const { updateConfig } = await import('../../../src/main/config/config-store')
    await updateConfig((draft) => { draft.gemini.slug = ` ${createDefaultConfig().gemini.slug.toUpperCase()} ` })
    expect(fs.existsSync(file())).toBe(false)
    await updateConfig((draft) => { draft.gemini.slug = '  my-model  ' })
    expect(stored()).toEqual({ gemini: { slug: 'my-model' } })
  })
  it('stores a path exactly as given', async () => {
    const { updateConfig } = await import('../../../src/main/config/config-store')
    await updateConfig((draft) => { draft.general.export_dir = '/tmp/exports ' })
    await updateConfig((draft) => { draft.image_backends.drawthings.models_dir = ' /tmp/models' })
    expect(stored()).toEqual({ general: { export_dir: '/tmp/exports ' }, image_backends: { drawthings: { models_dir: ' /tmp/models' } } })
  })
  it('drops an untouched copy equal to its built-in at the next save of another set', async () => {
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.config), general: { theme: 'system' }, prompts: { slug: `${createDefaultConfig().prompts.slug}\n\n` } }))
    const { updateConfig } = await import('../../../src/main/config/config-store')
    await updateConfig((draft) => { draft.general.language = 'ja' })
    expect(stored()).toEqual({ general: { language: 'ja' } })
  })
  it('writes nothing when the save equals the file', async () => {
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.config), general: { language: 'ja' } }))
    fs.utimesSync(file(), new Date(2000, 0, 1), new Date(2000, 0, 1))
    const { updateConfig } = await import('../../../src/main/config/config-store')
    await updateConfig((draft) => { draft.general.language = 'ja' })
    await updateConfig(() => undefined)
    expect(fs.statSync(file()).mtime.getFullYear()).toBe(2000)
    expect(fs.readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
  it('keeps a rejected copy through saves of other sets and rejects a changed set of the wrong shape', async () => {
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.config), general: { theme: 'bogus' } }))
    const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
    await updateConfig((draft) => { draft.general.language = 'ja' })
    expect(stored()).toEqual({ general: { theme: 'bogus', language: 'ja' } })
    await expect(updateConfig((draft) => { (draft.general as unknown as Record<string, unknown>).auto_preview_idle_seconds = 'soon' })).rejects.toThrow('general.auto_preview_idle_seconds')
    expect(stored()).toEqual({ general: { theme: 'bogus', language: 'ja' } })
    expect(loadConfig().general.language).toBe('ja')
    expect(loadConfig().general.theme).toBe('system')
  })
  it('stores the completion-sound volume only while it differs from its built-in, within 0 to 1', async () => {
    const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
    await updateConfig((draft) => { draft.notifications.volume = 0 })
    expect(stored()).toEqual({ notifications: { volume: 0 } })
    await updateConfig((draft) => { draft.notifications.volume = createDefaultConfig().notifications.volume })
    expect(stored()).toEqual({})
    await expect(updateConfig((draft) => { draft.notifications.volume = 1.5 })).rejects.toThrow('notifications.volume')
    expect(loadConfig().notifications.volume).toBe(createDefaultConfig().notifications.volume)
  })
  it('refuses the numbers Settings\' fields refuse, and reads a stored one as its built-in', async () => {
    const fallbacks = { ...createDefaultConfig().image_backends.drawthings.default_params, fallback_width: 1000 }
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.config), general: { auto_preview_idle_seconds: 2.5 }, image_backends: { openai: { concurrency: 11 }, drawthings: { default_params: fallbacks } } }))
    const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
    const defaults = createDefaultConfig()
    expect(loadConfig().general.auto_preview_idle_seconds).toBe(defaults.general.auto_preview_idle_seconds)
    expect(loadConfig().image_backends.openai.concurrency).toBe(defaults.image_backends.openai.concurrency)
    expect(loadConfig().image_backends.drawthings.default_params).toEqual(defaults.image_backends.drawthings.default_params)
    await expect(updateConfig((draft) => { draft.image_backends.grok.concurrency = 11 })).rejects.toThrow('image_backends.grok.concurrency')
    await expect(updateConfig((draft) => { draft.image_backends.drawthings.default_params.fallback_steps = 0 })).rejects.toThrow('default_params')
    await expect(updateConfig((draft) => { draft.image_backends.drawthings.default_params.fallback_guidance = -1 })).rejects.toThrow('default_params')
    await updateConfig((draft) => {
      draft.image_backends.flux.concurrency = 24
      draft.general.auto_preview_idle_seconds = 0
      draft.image_backends.drawthings.default_params.fallback_guidance = 0
      draft.image_backends.drawthings.default_params.fallback_steps = 200
    })
    expect(loadConfig().image_backends.flux.concurrency).toBe(24)
    expect(loadConfig().image_backends.drawthings.default_params).toMatchObject({ fallback_guidance: 0, fallback_steps: 200 })
  })
  it('reads a concurrency below one or a timeout not above zero as its built-in, and will not save one', async () => {
    const brainstorm = { ...createDefaultConfig().brainstorm, concurrency: 0 }
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.config), brainstorm, gemini: { timeout_ms: 0 }, image_backends: { flux: { concurrency: 0, timeout_ms: -1 } } }))
    const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
    const defaults = createDefaultConfig()
    expect(loadConfig().brainstorm).toEqual(defaults.brainstorm)
    expect(loadConfig().gemini.timeout_ms).toBe(defaults.gemini.timeout_ms)
    expect(loadConfig().image_backends.flux).toEqual(defaults.image_backends.flux)
    await expect(updateConfig((draft) => { draft.openai.timeout_ms = 0 })).rejects.toThrow('openai.timeout_ms')
    await updateConfig((draft) => { draft.general.language = 'ja' })
    expect(stored()).toEqual({
      general: { language: 'ja' }, brainstorm: { concurrency: 0 }, gemini: { timeout_ms: 0 },
      image_backends: { flux: { concurrency: 0, timeout_ms: -1 } },
    })
  })
  it('reads a timeout that is not whole seconds as its built-in, and will not save one', async () => {
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.config), image_backends: { drawthings: { timeout_ms: 1500 } } }))
    const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
    expect(loadConfig().image_backends.drawthings.timeout_ms).toBe(createDefaultConfig().image_backends.drawthings.timeout_ms)
    await expect(updateConfig((draft) => { draft.image_backends.flux.timeout_ms = 2500 })).rejects.toThrow('image_backends.flux.timeout_ms')
    await updateConfig((draft) => { draft.image_backends.flux.timeout_ms = 2000 })
    expect(loadConfig().image_backends.flux.timeout_ms).toBe(2000)
  })
  it.each([
    ['does not parse', '{ invalid'],
    ['is not a map of sets', '[]'],
    ['has no file header', JSON.stringify({ general: { language: 'de' } })],
    ['is of another kind', JSON.stringify({ ...header(FILE_FORMATS.elaborators), general: { language: 'de' } })],
    ['is of another owner', JSON.stringify({ format: { owner: 'picpatch', kind: 'config', version: 1 }, general: { language: 'de' } })],
    ['has a format version that is not an integer', JSON.stringify({ ...header(FILE_FORMATS.config, 'one'), general: { language: 'ja' } })],
  ])('stops naming a file that %s, and leaves it byte-identical through later saves', async (_state, bytes) => {
    fs.writeFileSync(file(), bytes)
    const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
    const { UnreadableFileError } = await import('../../../src/main/store-format')
    let thrown: unknown
    try { loadConfig() } catch (err) { thrown = err }
    expect(thrown).toBeInstanceOf(UnreadableFileError)
    expect((thrown as InstanceType<typeof UnreadableFileError>).path).toBe(file())
    await expect(updateConfig((draft) => { draft.general.language = 'ja' })).rejects.toBeInstanceOf(UnreadableFileError)
    expect(fs.readFileSync(file(), 'utf8')).toBe(bytes)
    expect(fs.readdirSync(root)).toEqual(['config.json'])
  })
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('halts naming a file it cannot read, and leaves it unchanged in place', async () => {
    const bytes = JSON.stringify({ ...header(FILE_FORMATS.config), general: { language: 'ja' } })
    fs.writeFileSync(file(), bytes)
    fs.chmodSync(file(), 0o000)
    const { loadConfig } = await import('../../../src/main/config/config-store')
    const { UnreadableFileError } = await import('../../../src/main/store-format')
    let thrown: unknown
    try { loadConfig() } catch (err) { thrown = err }
    fs.chmodSync(file(), 0o644)
    expect(thrown).toBeInstanceOf(UnreadableFileError)
    expect((thrown as InstanceType<typeof UnreadableFileError>).path).toBe(file())
    expect(fs.readFileSync(file(), 'utf8')).toBe(bytes)
    expect(fs.readdirSync(root)).toEqual(['config.json'])
  })
  it('saves against the map it loaded, so a file unreadable since load is neither read nor written', async () => {
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.config), general: { language: 'ja' } }))
    fs.utimesSync(file(), new Date(2000, 0, 1), new Date(2000, 0, 1))
    const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
    loadConfig()
    const read = vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw Object.assign(new Error('unreadable'), { code: 'EACCES' }) })
    await updateConfig(() => undefined)
    read.mockRestore()
    expect(fs.statSync(file()).mtime.getFullYear()).toBe(2000)
    expect(stored()).toEqual({ general: { language: 'ja' } })
  })
  it('reads a file whatever its writer says, and writes its own writer back', async () => {
    fs.writeFileSync(file(), JSON.stringify({ format: header(FILE_FORMATS.config).format, writer: { name: 'someone-else', version: 'not a version' }, general: { language: 'ja' } }))
    const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
    expect(loadConfig().general.language).toBe('ja')
    await updateConfig((draft) => { draft.general.language = 'de' })
    expect(JSON.parse(fs.readFileSync(file(), 'utf8')).writer).toEqual(header(FILE_FORMATS.config).writer)
  })
  it('writes its file header first and reads it back', async () => {
    const { updateConfig } = await import('../../../src/main/config/config-store')
    const { FILE_FORMATS } = await import('../../../src/main/store-format')
    await updateConfig((draft) => { draft.general.language = 'ja' })
    expect(Object.entries(JSON.parse(fs.readFileSync(file(), 'utf8'))).slice(0, 2)).toEqual(Object.entries(header(FILE_FORMATS.config)))
    vi.resetModules()
    const reloaded = await import('../../../src/main/config/config-store')
    expect(reloaded.loadConfig().general.language).toBe('ja')
  })
  it('halts on a file from a newer version, naming it, and leaves its bytes as they were', async () => {
    const { FILE_FORMATS, NewerFormatError } = await import('../../../src/main/store-format')
    const bytes = JSON.stringify({ ...header(FILE_FORMATS.config, FILE_FORMATS.config.version + 1), general: { language: 'ja' } })
    fs.writeFileSync(file(), bytes)
    const { loadConfig } = await import('../../../src/main/config/config-store')
    let thrown: unknown
    try { loadConfig() } catch (err) { thrown = err }
    expect(thrown).toBeInstanceOf(NewerFormatError)
    expect((thrown as InstanceType<typeof NewerFormatError>).path).toBe(file())
    expect(fs.readFileSync(file(), 'utf8')).toBe(bytes)
    expect(fs.readdirSync(root)).toEqual(['config.json'])
  })
  it('warns once, naming the key, for a set that fails its check', async () => {
    const log = vi.fn()
    vi.doMock('../../../src/main/logger', async (importOriginal) => ({ ...await importOriginal<object>(), log }))
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.config), general: { theme: 'bogus' } }))
    try {
      const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
      loadConfig()
      await updateConfig((draft) => { draft.general.language = 'ja' })
      await updateConfig((draft) => { draft.general.language = 'de' })
      expect(stored().general.theme).toBe('bogus')
      await updateConfig((draft) => { draft.general.theme = 'dark' })
      expect(loadConfig().general.theme).toBe('dark')
      expect(stored().general.theme).toBe('dark')
    } finally {
      vi.doUnmock('../../../src/main/logger')
    }
    expect(log.mock.calls.filter(([level]) => level === 'warn')).toEqual([['warn', 'Invalid config set; using built-in', { key: 'general.theme' }]])
  })
  it('keeps a chosen display zone and carries an unknown one through unchanged as System', async () => {
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.config), general: { time_zone: 'Europe/Berlin' } }))
    const store = await import('../../../src/main/config/config-store')
    expect(store.loadConfig().general.time_zone).toBe('Europe/Berlin')
    vi.resetModules()
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.config), general: { time_zone: 'Mars/Olympus' } }))
    const reloaded = await import('../../../src/main/config/config-store')
    expect(reloaded.loadConfig().general.time_zone).toBe('system')
    expect(stored()).toEqual({ general: { time_zone: 'Mars/Olympus' } })
  })
  it('tells its listeners after each save, whichever surface made it', async () => {
    const { onConfigSaved, updateConfig } = await import('../../../src/main/config/config-store')
    const listener = vi.fn()
    const stop = onConfigSaved(listener)
    await updateConfig((draft) => { draft.notifications.notifications_enabled = false })
    expect(listener).toHaveBeenCalledOnce()
    stop()
    await updateConfig((draft) => { draft.notifications.notifications_enabled = true })
    expect(listener).toHaveBeenCalledOnce()
  })
  // Elaboration Settings is one way to set these counts; a hand-edited file or
  // any other caller of the save meets the same limits here.
  describe.each(Object.entries(BRAINSTORM_LIMITS))('the elaboration %s', (name, { min, max }) => {
    type Count = keyof typeof BRAINSTORM_LIMITS
    it.each([min - 1, max + 1, min + 0.5])('reads a stored %s as its built-in', async (value) => {
      fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.config), brainstorm: { [name]: value } }))
      const { loadConfig } = await import('../../../src/main/config/config-store')
      expect(loadConfig().brainstorm[name as Count]).toBe(createDefaultConfig().brainstorm[name as Count])
    })
    it.each([min - 1, max + 1, min + 0.5])('refuses to save %s', async (value) => {
      const { updateConfig } = await import('../../../src/main/config/config-store')
      await expect(updateConfig((draft) => { draft.brainstorm[name as Count] = value })).rejects.toMatchObject({ name: 'InvalidConfigSetError' })
    })
    it.each([min, max])('saves %s', async (value) => {
      const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
      await updateConfig((draft) => { draft.brainstorm[name as Count] = value })
      expect(loadConfig().brainstorm[name as Count]).toBe(value)
    })
  })
  it('keeps every built-in text in its cleaned form', async () => {
    const { configSetDefaults, cleanConfigSet } = await import('../../../src/main/config/config-sets')
    for (const [key, builtIn] of Object.entries(configSetDefaults())) expect(cleanConfigSet(key, builtIn), key).toEqual(builtIn)
  })
  it('reads an invalid set as absent without repairing or quarantining the file', async () => {
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.config), general: { theme: 'bogus' } }))
    const { loadConfig } = await import('../../../src/main/config/config-store')
    expect(loadConfig()).toEqual(createDefaultConfig())
    expect(stored()).toEqual({ general: { theme: 'bogus' } })
  })
  it('writes the file from the config in memory, not from a set changed on disk since load', async () => {
    const { loadConfig, updateConfig } = await import('../../../src/main/config/config-store')
    loadConfig()
    fs.writeFileSync(file(), JSON.stringify({ ...header(FILE_FORMATS.config), general: { language: 'ja' } }))
    await updateConfig((draft) => { draft.notifications.notifications_enabled = false })
    expect(stored()).toEqual({ notifications: { notifications_enabled: false } })
  })
})
