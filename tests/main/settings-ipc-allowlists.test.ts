import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../../src/main/config/types'

// What the renderer is allowed to write. Every one of these handlers takes an
// identifier from the window and uses it to reach into config or the key store,
// so each has an allowlist that must hold — and the keys have a second rule: the
// form is shown what is STORED, while presence answers what is RESOLVABLE, so a
// key supplied by the environment can never be overwritten by a form save.
type Handler = (...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  config: {} as AppConfig,
  saveConfig: vi.fn(),
  storedKeys: new Map<string, string>(),
  resolvableKeys: new Set<string>(),
  setStoredApiKey: vi.fn((id: string, value: string) => mocks.storedKeys.set(id, value)),
  refreshMainWindowMinimumSize: vi.fn(),
  startCliJob: vi.fn(() => 'job-1'),
  subscribeCliJob: vi.fn(),
  unsubscribeCliJob: vi.fn(),
  killCliJob: vi.fn(),
  resolveCliPath: vi.fn(() => '/cli/dtcli'),
  ensureModelsDir: vi.fn(() => '/models'),
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  ClipboardItem: class {},
  clipboard: { readText: vi.fn(async () => ''), write: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn() },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
}))
vi.mock('../../src/main/ipc-boundary', () => ({
  handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
}))
vi.mock('../../src/main/config', () => ({ loadConfig: () => mocks.config, saveConfig: mocks.saveConfig }))
vi.mock('../../src/main/config/api-keys-store', () => ({
  getStoredApiKey: (id: string) => mocks.storedKeys.get(id) ?? '',
  setStoredApiKey: mocks.setStoredApiKey,
  hasApiKey: (id: string) => mocks.resolvableKeys.has(id),
}))
vi.mock('../../src/main/settings-changes', () => ({ applyChangedFields: vi.fn() }))
vi.mock('../../src/main/main-window-layout', () => ({
  refreshMainWindowMinimumSize: mocks.refreshMainWindowMinimumSize,
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

const { registerSettingsIpc } = await import('../../src/main/settings-ipc')
const { CLOUD_BACKEND_IDS_IN_UI_ORDER, IMAGE_BACKEND_SECRET, SECRET_IDS } = await import('../../src/shared/types')

function invoke(channel: string, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`${channel} was not registered`)
  return handler({ sender: {} }, ...args)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.storedKeys.clear()
  mocks.resolvableKeys.clear()
  mocks.config = {
    general: {},
    brainstorm: { aspects: ['light'] },
    notifications: { notifications_enabled: false, sounds_enabled: false, success_file: '', failure_file: '' },
    image_backends: {
      openai: { model: 'gpt-image-2', default_params: { size: '1024x1024', quality: 'high' } },
      nanobanana: { model: 'nano-banana-2', default_params: {} },
    },
  } as unknown as AppConfig
  mocks.handlers.clear()
  registerSettingsIpc()
})

describe('API keys', () => {
  it('shows the form what is stored, and nothing an environment variable supplied', () => {
    mocks.storedKeys.set('openai.image', 'sk-stored')
    mocks.resolvableKeys.add('openai.image').add('gemini.text')

    const keys = invoke('settings:getApiKeys') as Record<string, string>

    expect(Object.keys(keys).sort()).toEqual([...SECRET_IDS].sort())
    expect(keys['openai.image']).toBe('sk-stored')
    expect(keys['gemini.text'], 'an env-supplied key stays invisible to the form').toBe('')
  })

  it('answers separately which keys can actually be resolved', () => {
    mocks.resolvableKeys.add(IMAGE_BACKEND_SECRET[CLOUD_BACKEND_IDS_IN_UI_ORDER[0]]).add('gemini.text')

    const presence = invoke('settings:getApiKeyPresence') as {
      image: Record<string, boolean>
      geminiText: boolean
      openaiText: boolean
    }

    expect(presence.image[CLOUD_BACKEND_IDS_IN_UI_ORDER[0]]).toBe(true)
    expect(presence.image[CLOUD_BACKEND_IDS_IN_UI_ORDER[1]]).toBe(false)
    expect(presence).toMatchObject({ geminiText: true, openaiText: false })
    expect(JSON.stringify(presence), 'presence never carries a value').not.toContain('sk-')
  })

  it('stores the keys it was given and re-measures the window, since a key can add a column', () => {
    invoke('settings:saveApiKeys', { 'openai.image': 'sk-new', 'gemini.text': '' })

    expect(mocks.setStoredApiKey).toHaveBeenCalledWith('openai.image', 'sk-new')
    expect(mocks.setStoredApiKey, 'clearing one is a save too').toHaveBeenCalledWith('gemini.text', '')
    expect(mocks.refreshMainWindowMinimumSize).toHaveBeenCalledOnce()
  })

  it('refuses an id outside the known set, before anything is written', () => {
    expect(() => invoke('settings:saveApiKeys', { 'openai.image': 'sk-new', 'evil.key': 'x' })).toThrow(
      /unsupported api key: evil.key/,
    )
    expect(mocks.setStoredApiKey).not.toHaveBeenCalled()
  })

  it('leaves the window alone when there was nothing to save', () => {
    expect(invoke('settings:saveApiKeys', {})).toEqual({ success: true })
    expect(invoke('settings:saveApiKeys', undefined)).toEqual({ success: true })
    expect(mocks.refreshMainWindowMinimumSize).not.toHaveBeenCalled()
  })
})

describe('image backend defaults', () => {
  it('replaces the model and merges the parameters onto what was there', () => {
    expect(invoke('settings:saveImageBackendDefaults', 'openai', 'gpt-image-3', { quality: 'low' })).toEqual({
      success: true,
    })

    expect((mocks.config as unknown as Record<string, Record<string, unknown>>).image_backends.openai).toEqual({
      model: 'gpt-image-3',
      default_params: { size: '1024x1024', quality: 'low' },
    })
    expect(mocks.saveConfig).toHaveBeenCalledExactlyOnceWith(mocks.config)
  })

  it('refuses a backend it does not have, and writes nothing', () => {
    expect(() => invoke('settings:saveImageBackendDefaults', 'drawthings', 'm', {})).toThrow(
      /unsupported backend: drawthings/,
    )
    expect(() => invoke('settings:saveImageBackendDefaults', '__proto__', 'm', {})).toThrow(/unsupported backend/)
    expect(mocks.saveConfig).not.toHaveBeenCalled()
  })
})

describe('notification settings', () => {
  it.each(['notifications_enabled', 'sounds_enabled', 'success_file', 'failure_file'])(
    'saves %s',
    (field) => {
      expect(invoke('settings:saveNotificationField', field, 'value')).toEqual({ success: true })

      expect((mocks.config.notifications as unknown as Record<string, unknown>)[field]).toBe('value')
      expect(mocks.saveConfig).toHaveBeenCalledOnce()
    },
  )

  it('refuses a field outside that set', () => {
    expect(() => invoke('settings:saveNotificationField', 'export_dir', '/somewhere')).toThrow(
      /unsupported notification setting: export_dir/,
    )
    expect(mocks.saveConfig).not.toHaveBeenCalled()
  })
})

describe('brainstorm settings', () => {
  it('replaces the whole section and writes it', () => {
    const brainstorm = { aspects: ['light', 'mood'] } as unknown as AppConfig['brainstorm']

    expect(invoke('settings:saveBrainstorm', brainstorm)).toEqual({ success: true })

    expect(mocks.config.brainstorm).toBe(brainstorm)
    expect(mocks.saveConfig).toHaveBeenCalledExactlyOnceWith(mocks.config)
  })
})

describe('Draw Things CLI jobs', () => {
  it('imports a chosen artifact into the managed models directory and follows the job', () => {
    const jobId = invoke('cli-job:startImport', '/downloads/model.ckpt')

    expect(jobId).toBe('job-1')
    expect(mocks.startCliJob).toHaveBeenCalledExactlyOnceWith({
      kind: 'import',
      cliPath: '/cli/dtcli',
      args: ['models', 'import', '/downloads/model.ckpt', '--models-dir', '/models'],
      target: 'model.ckpt',
      logContext: { artifactPath: '/downloads/model.ckpt' },
    })
    expect(mocks.subscribeCliJob).toHaveBeenCalledExactlyOnceWith('job-1', expect.anything())
  })

  it('downloads a named model into the same place and follows that job', () => {
    invoke('cli-job:startDownload', 'sd_v1.5_f16.ckpt')

    expect(mocks.startCliJob).toHaveBeenCalledExactlyOnceWith({
      kind: 'download',
      cliPath: '/cli/dtcli',
      args: ['models', 'ensure', '--model', 'sd_v1.5_f16.ckpt', '--models-dir', '/models'],
      target: 'sd_v1.5_f16.ckpt',
      logContext: { modelFile: 'sd_v1.5_f16.ckpt' },
    })
  })

  it('lets a window follow, stop following, and kill a job', () => {
    invoke('cli-job:subscribe', 'job-7')
    invoke('cli-job:unsubscribe', 'job-7')
    invoke('cli-job:kill', 'job-7')

    expect(mocks.subscribeCliJob).toHaveBeenCalledWith('job-7', expect.anything())
    expect(mocks.unsubscribeCliJob).toHaveBeenCalledWith('job-7', expect.anything())
    expect(mocks.killCliJob).toHaveBeenCalledExactlyOnceWith('job-7')
  })
})
