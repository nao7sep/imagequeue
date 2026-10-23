import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../../src/main/config/types'

// What the renderer is allowed to write. Every one of these handlers takes an
// identifier from the window and uses it to reach into config or the key store,
// so each has an allowlist that must hold — and the keys have a second rule: the
// form is shown what is STORED, while presence answers what is RESOLVABLE, so a
// key supplied by the environment can never be overwritten by a form save.
type Handler = (...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  broadcast: vi.fn(),
  setDrawThingsReady: vi.fn(),
  root: '',
  showMessageBox: vi.fn(),
  showOpenDialog: vi.fn(),
  config: {} as AppConfig,
  saveConfig: vi.fn(),
  storedKeys: new Map<string, string>(),
  resolvableKeys: new Set<string>(),
  setStoredApiKeys: vi.fn(async (changes: Record<string, string>) => {
    for (const [id, value] of Object.entries(changes)) mocks.storedKeys.set(id, value)
  }),
  refreshApiKeys: vi.fn(async () => {}),
  refreshMainWindowMinimumSize: vi.fn(),
  startCliJob: vi.fn(() => 'job-1'),
  subscribeCliJob: vi.fn(),
  unsubscribeCliJob: vi.fn(),
  killCliJob: vi.fn(),
  resolveCliPath: vi.fn(() => '/cli/dtcli'),
  ensureModelsDir: vi.fn(() => '/models'),
}))

vi.mock('../../src/main/presentation', () => ({ broadcastPresentation: mocks.broadcast }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  ClipboardItem: class {},
  clipboard: { readText: vi.fn(async () => ''), write: vi.fn() },
  dialog: { showOpenDialog: mocks.showOpenDialog, showSaveDialog: vi.fn(), showMessageBox: mocks.showMessageBox },
  nativeImage: { createFromBuffer: vi.fn() },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
}))
vi.mock('../../src/main/ipc-boundary', () => ({
  handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
}))
// updateConfig's copy-then-swap is the config store's own contract (tested
// there); here it applies to the shared object so the handlers' edits are visible.
vi.mock('../../src/main/config', () => ({
  loadConfig: () => mocks.config,
  getDataDir: () => mocks.root,
  updateConfig: (apply: (draft: AppConfig) => void) => {
    apply(mocks.config)
    return Promise.resolve(mocks.saveConfig(mocks.config)).then(() => mocks.config)
  },
}))
vi.mock('../../src/main/config/api-keys-store', () => ({
  refreshApiKeys: mocks.refreshApiKeys,
  getStoredApiKey: vi.fn((id: string) => mocks.storedKeys.get(id) ?? ''),
  setStoredApiKeys: mocks.setStoredApiKeys,
  hasApiKey: vi.fn((id: string) => mocks.resolvableKeys.has(id)),
}))
vi.mock('../../src/main/i18n', () => ({ mainTranslator: () => ({ t: (key: string) => key }) }))
vi.mock('../../src/main/settings-changes', () => ({ applyChangedFields: vi.fn() }))
vi.mock('../../src/main/main-window-layout', () => ({
  refreshMainWindowMinimumSize: mocks.refreshMainWindowMinimumSize,
  setDrawThingsReady: mocks.setDrawThingsReady,
}))
vi.mock('../../src/main/session', () => ({ getSessionDir: () => '/session' }))
vi.mock('../../src/main/logger', () => ({ log: vi.fn(), serializeError: (error: unknown) => ({ error }) }))
vi.mock('../../src/main/cli-jobs', () => ({
  startCliJob: mocks.startCliJob,
  subscribeCliJob: mocks.subscribeCliJob,
  unsubscribeCliJob: mocks.unsubscribeCliJob,
  killCliJob: mocks.killCliJob,
}))
vi.mock('../../src/main/local-cli', () => ({
  checkCli: vi.fn(),
  listDownloadedModels: vi.fn(),
  listAvailableModels: vi.fn(),
  readCustomJsonImportedFiles: vi.fn(),
  resolveCliPath: mocks.resolveCliPath,
  ensureModelsDir: mocks.ensureModelsDir,
}))

vi.mock('../../src/main/backend-defaults', () => ({
  saveImageBackendDefaults: async (backend: string, model: string, params: Record<string, unknown>) => {
    (mocks.config.image_backends as unknown as Record<string, unknown>)[backend] = { model, default_params: params }
    mocks.saveConfig(mocks.config)
  },
}))

const { registerSettingsIpc } = await import('../../src/main/settings-ipc')
const { registerNotificationIpc } = await import('../../src/main/notification')
const { CLOUD_BACKEND_IDS_IN_UI_ORDER, IMAGE_BACKEND_SECRET, SECRET_IDS } = await import('../../src/shared/types')

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`${channel} was not registered`)
  return handler({ sender: { once: vi.fn(), on: vi.fn(), removeListener: vi.fn(), isDestroyed: () => false } }, ...args)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(fs.promises, 'realpath').mockImplementation(async (candidate) => String(candidate))
  mocks.root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-settings-sound-'))
  mocks.showMessageBox.mockReset().mockResolvedValue({ response: 0 })
  mocks.storedKeys.clear()
  mocks.resolvableKeys.clear()
  mocks.config = {
    general: {},
    brainstorm: { aspects: ['light'] },
    notifications: { notifications_enabled: false, sounds_enabled: false, success_file: '', failure_file: '' },
    image_backends: {
      openai: { model: 'gpt-image-2', default_params: { size: '1024x1024', quality: 'high' } },
      nanobanana: { model: 'nano-banana-2', default_params: {} },
      drawthings: { models_dir: '/models' },
    },
  } as unknown as AppConfig
  mocks.handlers.clear()
  registerSettingsIpc()
  registerNotificationIpc()
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(mocks.root, { recursive: true, force: true })
})

it('publishes the saved font to every surface only after the settings write succeeds', async () => {
  const base = structuredClone(mocks.config)
  base.general.ui_font_family = ''
  mocks.config.general.ui_font_family = 'Custom Font'
  let release!: () => void
  mocks.saveConfig.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve }))
  const save = invoke('settings:saveChangedFields', base, mocks.config)
  expect(mocks.broadcast).not.toHaveBeenCalled()
  release()
  await save
  expect(mocks.broadcast).toHaveBeenCalledExactlyOnceWith('settings:uiFont', 'Custom Font')
  mocks.broadcast.mockClear()
  mocks.saveConfig.mockRejectedValueOnce(new Error('disk full'))
  await expect(invoke('settings:saveChangedFields', base, mocks.config)).rejects.toThrow('disk full')
  expect(mocks.broadcast).not.toHaveBeenCalled()
  mocks.setStoredApiKeys.mockRejectedValueOnce(new Error('keys unavailable'))
  await expect(invoke('settings:saveChangedFields', base, mocks.config, { 'openai.image': 'new-key' })).rejects.toThrow('keys unavailable')
  expect(mocks.broadcast).toHaveBeenCalledExactlyOnceWith('settings:uiFont', 'Custom Font')
})

describe('API keys', () => {
  it('shows the form what is stored, and nothing an environment variable supplied', async () => {
    mocks.storedKeys.set('openai.image', 'sk-stored')
    mocks.resolvableKeys.add('openai.image').add('gemini.text')

    const { keys } = await invoke('settings:getCredentials') as { keys: Record<string, string> }

    expect(Object.keys(keys).sort()).toEqual([...SECRET_IDS].sort())
    expect(keys['openai.image']).toBe('sk-stored')
    expect(keys['gemini.text'], 'an env-supplied key stays invisible to the form').toBe('')
  })

  it('answers separately which keys can actually be resolved', async () => {
    mocks.resolvableKeys.add(IMAGE_BACKEND_SECRET[CLOUD_BACKEND_IDS_IN_UI_ORDER[0]]).add('gemini.text')

    const { presence } = await invoke('settings:getCredentials') as { presence: {
      image: Record<string, boolean>
      geminiText: boolean
      openaiText: boolean
    } }

    expect(presence.image[CLOUD_BACKEND_IDS_IN_UI_ORDER[0]]).toBe(true)
    expect(presence.image[CLOUD_BACKEND_IDS_IN_UI_ORDER[1]]).toBe(false)
    expect(presence).toMatchObject({ geminiText: true, openaiText: false })
    expect(JSON.stringify(presence), 'presence never carries a value').not.toContain('sk-')
  })

  it('refreshes once after an unrelated save and shares externally repaired presence with layout', async () => {
    const store = await vi.importActual<typeof import('../../src/main/config/api-keys-store')>('../../src/main/config/api-keys-store')
    const boundary = await import('../../src/main/config/api-keys-store')
    const { FORMAT_VERSIONS } = await import('../../src/main/store-format')
    const envNames = ['IMAGEQUEUE_DATA_DIR', ...SECRET_IDS.map((id) => `${id.toUpperCase().replaceAll('.', '_')}_API_KEY`)]
    const previous = envNames.map((name) => process.env[name])
    try {
      for (const name of envNames) delete process.env[name]
      process.env.IMAGEQUEUE_DATA_DIR = mocks.root
      process.env.GEMINI_TEXT_API_KEY = 'environment-text-secret'
      mocks.refreshApiKeys.mockImplementation(store.refreshApiKeys)
      vi.mocked(boundary.getStoredApiKey).mockImplementation(store.getStoredApiKey)
      vi.mocked(boundary.hasApiKey).mockImplementation(store.hasApiKey)
      await invoke('settings:getCredentials')
      fs.writeFileSync(path.join(mocks.root, 'api-keys.json'), JSON.stringify({
        formatVersion: FORMAT_VERSIONS.apiKeys, keys: { 'openai.image': 'repaired-key' },
      }), { mode: 0o600 })
      await invoke('settings:saveChangedFields', mocks.config, mocks.config, {})
      const read = vi.spyOn(fs.promises, 'readFile')
      let layoutPresent = false
      mocks.refreshMainWindowMinimumSize.mockImplementation(() => { layoutPresent = store.hasApiKey('openai.image') })
      const snapshot = await invoke('settings:getCredentials') as import('../../src/shared/types').SettingsCredentials
      expect(read.mock.calls.filter(([file]) => String(file) === path.join(mocks.root, 'api-keys.json'))).toHaveLength(1)
      expect(snapshot.keys['openai.image']).toBe('repaired-key')
      expect(snapshot.presence.image.openai).toBe(true)
      expect(layoutPresent).toBe(true)
      expect(snapshot.keys['gemini.text']).toBe('')
      expect(snapshot.presence.geminiText).toBe(true)
      expect(JSON.stringify(snapshot)).not.toContain('environment-text-secret')
    } finally {
      envNames.forEach((name, index) => {
        if (previous[index] === undefined) delete process.env[name]
        else process.env[name] = previous[index]
      })
      mocks.refreshApiKeys.mockImplementation(async () => {})
      vi.mocked(boundary.getStoredApiKey).mockImplementation((id) => mocks.storedKeys.get(id) ?? '')
      vi.mocked(boundary.hasApiKey).mockImplementation((id) => mocks.resolvableKeys.has(id))
      mocks.refreshMainWindowMinimumSize.mockImplementation(() => {})
    }
  })

  it('stores the keys it was given and re-measures the window, since a key can add a column', async () => {
    await invoke('settings:saveChangedFields', mocks.config, mocks.config, { 'openai.image': 'sk-new', 'gemini.text': '' })

    expect(mocks.setStoredApiKeys).toHaveBeenCalledWith({ 'openai.image': 'sk-new', 'gemini.text': '' })
    expect(mocks.refreshMainWindowMinimumSize).toHaveBeenCalledOnce()
  })

  it('refuses an id outside the known set, before anything is written', async () => {
    await expect(invoke('settings:saveChangedFields', mocks.config, mocks.config, { 'openai.image': 'sk-new', 'evil.key': 'x' })).rejects.toThrow(
      /unsupported api key: evil.key/,
    )
    expect(mocks.setStoredApiKeys).not.toHaveBeenCalled()
  })

  it('leaves the window alone when there was nothing to save', async () => {
    expect(await invoke('settings:saveChangedFields', mocks.config, mocks.config, {})).toEqual({ success: true })
    expect(await invoke('settings:saveChangedFields', mocks.config, mocks.config, undefined)).toEqual({ success: true })
    expect(mocks.refreshMainWindowMinimumSize).not.toHaveBeenCalled()
  })
})

describe('image backend defaults', () => {
  it('replaces the model and parameters as one set', async () => {
    expect(await invoke('settings:saveImageBackendDefaults', 'openai', 'gpt-image-3', { quality: 'low' })).toEqual({
      success: true,
    })

    expect((mocks.config as unknown as Record<string, Record<string, unknown>>).image_backends.openai).toEqual({
      model: 'gpt-image-3',
      default_params: { quality: 'low' },
    })
    expect(mocks.saveConfig).toHaveBeenCalledExactlyOnceWith(mocks.config)
  })

  it('refuses a backend it does not have, and writes nothing', async () => {
    await expect(invoke('settings:saveImageBackendDefaults', 'drawthings', 'm', {})).rejects.toThrow(
      /unsupported backend: drawthings/,
    )
    await expect(invoke('settings:saveImageBackendDefaults', '__proto__', 'm', {})).rejects.toThrow(/unsupported backend/)
    expect(mocks.saveConfig).not.toHaveBeenCalled()
  })
})

describe('notification settings', () => {
  it.each(['notifications_enabled', 'sounds_enabled'])(
    'saves %s',
    async (field) => {
      expect(await invoke('settings:saveNotificationField', field, 'value')).toEqual({ success: true })

      expect((mocks.config.notifications as unknown as Record<string, unknown>)[field]).toBe('value')
      expect(mocks.saveConfig).toHaveBeenCalledOnce()
    },
  )

  it.each(['success_file', 'failure_file'])('requires native consent before saving a typed %s', async (field) => {
    const file = path.join(mocks.root, 'typed.wav')
    fs.writeFileSync(file, 'sound')
    await expect(invoke('settings:saveNotificationField', field, file)).rejects.toThrow('Sound file access was not granted')
    expect(mocks.saveConfig).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(mocks.root, 'sound-file-grants.json'))).toBe(false)
    mocks.showMessageBox.mockResolvedValueOnce({ response: 1 })
    await expect(invoke('settings:saveNotificationField', field, file)).resolves.toEqual({ success: true })
    expect((mocks.config.notifications as unknown as Record<string, unknown>)[field]).toBe(file)
    expect(mocks.saveConfig).toHaveBeenCalledOnce()
  })

  it('grants a native Browse selection for later use without a second question', async () => {
    const file = path.join(mocks.root, 'picked.wav')
    fs.writeFileSync(file, 'sound')
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [file] })
    await expect(invoke('dialog:openFile', [])).resolves.toBe(file)
    await expect(invoke('settings:saveNotificationField', 'success_file', file)).resolves.toEqual({ success: true })
    await expect(invoke('notification:loadAudioFile', file)).resolves.toMatch(/^iq-audio:\/\/sound\//)
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
  })

  it('does not grant a canceled Browse selection', async () => {
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await expect(invoke('dialog:openFile', [])).resolves.toBeNull()
    expect(fs.existsSync(path.join(mocks.root, 'sound-file-grants.json'))).toBe(false)
  })

  it('refuses a field outside that set', async () => {
    await expect(invoke('settings:saveNotificationField', 'export_dir', '/somewhere')).rejects.toThrow(
      /unsupported notification setting: export_dir/,
    )
    expect(mocks.saveConfig).not.toHaveBeenCalled()
  })
})

describe('brainstorm settings', () => {
  it('replaces the whole section and writes it', async () => {
    const brainstorm = { aspects: ['light', 'mood'] } as unknown as AppConfig['brainstorm']

    expect(await invoke('settings:saveBrainstorm', brainstorm)).toEqual({ success: true })

    expect(mocks.config.brainstorm).toBe(brainstorm)
    expect(mocks.saveConfig).toHaveBeenCalledExactlyOnceWith(mocks.config)
  })
})

describe('Draw Things CLI jobs', () => {
  it('imports a chosen artifact into the managed models directory and follows the job', async () => {
    const jobId = await invoke('cli-job:startImport', '/downloads/model.ckpt')

    expect(jobId).toBe('job-1')
    expect(mocks.startCliJob).toHaveBeenCalledExactlyOnceWith({
      kind: 'import',
      modelsDir: '/models',
      sourceIdentity: '/downloads/model.ckpt',
      cliPath: '/cli/dtcli',
      args: ['models', 'import', '/downloads/model.ckpt', '--models-dir', '/models'],
      target: 'model.ckpt',
      logContext: { artifactPath: '/downloads/model.ckpt' },
    })
    expect(mocks.subscribeCliJob).toHaveBeenCalledExactlyOnceWith('job-1', expect.anything())
  })

  it('downloads a named model into the same place and follows that job', async () => {
    await invoke('cli-job:startDownload', 'sd_v1.5_f16.ckpt')

    expect(mocks.startCliJob).toHaveBeenCalledExactlyOnceWith({
      kind: 'download',
      modelsDir: '/models',
      sourceIdentity: 'sd_v1.5_f16.ckpt',
      cliPath: '/cli/dtcli',
      args: ['models', 'ensure', '--model', 'sd_v1.5_f16.ckpt', '--models-dir', '/models'],
      target: 'sd_v1.5_f16.ckpt',
      logContext: { modelFile: 'sd_v1.5_f16.ckpt' },
    })
  })

  it('uses the actual canonical destination directory for both admission and the CLI arguments', async () => {
    const destination = path.join(mocks.root, 'models')
    fs.mkdirSync(destination)
    vi.mocked(fs.promises.realpath).mockRestore()
    mocks.ensureModelsDir.mockReturnValueOnce(`${destination}/../models`)
    await invoke('cli-job:startDownload', 'model.ckpt')
    const canonicalDestination = fs.realpathSync(destination)
    expect(mocks.startCliJob).toHaveBeenCalledWith(expect.objectContaining({
      modelsDir: canonicalDestination,
      sourceIdentity: 'model.ckpt',
      args: ['models', 'ensure', '--model', 'model.ckpt', '--models-dir', canonicalDestination],
    }))
  })

  it('lets a window follow, stop following, and kill a job', async () => {
    await invoke('cli-job:subscribe', 'job-7')
    await invoke('cli-job:unsubscribe', 'job-7')
    await invoke('cli-job:kill', 'job-7')

    expect(mocks.subscribeCliJob).toHaveBeenCalledWith('job-7', expect.anything())
    expect(mocks.unsubscribeCliJob).toHaveBeenCalledWith('job-7', expect.anything())
    expect(mocks.killCliJob).toHaveBeenCalledExactlyOnceWith('job-7')
  })
})

it('captures all key edits while the config publication is still held', async () => {
  let release!: () => void
  mocks.saveConfig.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve }))
  const submitted = invoke('settings:saveChangedFields', mocks.config, mocks.config, { 'openai.image': 'new-one', 'gemini.text': 'new-two' })
  expect(mocks.setStoredApiKeys).toHaveBeenCalledWith({ 'openai.image': 'new-one', 'gemini.text': 'new-two' })
  release()
  await submitted
})

it.each(['cli-job:startImport', 'cli-job:startDownload'])('refuses %s if quit starts during directory preparation, then allows a fresh request after Cancel', async (channel) => {
  const { setQuitting } = await import('../../src/main/quit-state')
  let release!: (value: string) => void
  mocks.ensureModelsDir.mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve }) as unknown as string)
  const submitted = invoke(channel, 'model')
  setQuitting(true)
  release('/models')
  try {
    await expect(submitted).rejects.toThrow('quitting')
    expect(mocks.startCliJob).not.toHaveBeenCalled()
  } finally { setQuitting(false) }
  await invoke(channel, 'model')
  expect(mocks.startCliJob).toHaveBeenCalledOnce()
})

it.each(['relative/model.ckpt', '~/models/file.ckpt', '$HOME/models/file.ckpt'])('resolves authored model imports against Home before invoking the CLI: %s', async (source) => {
  await invoke('cli-job:startImport', source)
  const expected = path.join(os.homedir(), source.startsWith('~/') ? source.slice(2) : source)
  expect(mocks.startCliJob).toHaveBeenCalledWith(expect.objectContaining({ args: ['models', 'import', expected, '--models-dir', '/models'] }))
})

it('keeps a native absolute model source literal', async () => {
  const source = path.join(os.homedir(), ' $HOME%MODEL% .ckpt ')
  await invoke('cli-job:startImport', source)
  expect(mocks.startCliJob).toHaveBeenCalledWith(expect.objectContaining({ args: ['models', 'import', source, '--models-dir', '/models'] }))
})

describe('authoritative local readiness', () => {
  it('ignores an older inventory result after a newer failed check', async () => {
    const cli = await import('../../src/main/local-cli')
    let finish!: (value: Awaited<ReturnType<typeof cli.listDownloadedModels>>) => void
    vi.mocked(cli.listDownloadedModels).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const older = invoke('local:listDownloadedModels')
    vi.mocked(cli.checkCli).mockRejectedValueOnce(new Error('CLI failed'))
    await expect(invoke('local:checkCli')).rejects.toThrow('CLI failed')
    expect(mocks.setDrawThingsReady).toHaveBeenCalledExactlyOnceWith(false)
    finish([{ file: 'model.ckpt' } as Awaited<ReturnType<typeof cli.listDownloadedModels>>[number]])
    await older
    expect(mocks.setDrawThingsReady).toHaveBeenCalledOnce()
  })

  it('ignores a completed inventory from the previous models directory', async () => {
    const cli = await import('../../src/main/local-cli')
    let finish!: (value: Awaited<ReturnType<typeof cli.listDownloadedModels>>) => void
    vi.mocked(cli.listDownloadedModels).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const older = invoke('local:listDownloadedModels')
    mocks.config.image_backends.drawthings.models_dir = '/other-models'
    finish([])
    await older
    expect(mocks.setDrawThingsReady).not.toHaveBeenCalled()
  })
})
