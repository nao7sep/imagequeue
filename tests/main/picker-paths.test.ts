import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../../src/main/config/types'

type Handler = (...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  config: { general: { export_dir: '' } } as AppConfig,
  sessionDir: '',
  desktop: '',
  owner: null as unknown,
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  showItemInFolder: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => mocks.desktop) },
  BrowserWindow: { fromWebContents: vi.fn(() => mocks.owner) },
  ClipboardItem: class {},
  clipboard: { readText: vi.fn(async () => ''), write: vi.fn() },
  dialog: { showOpenDialog: mocks.showOpenDialog, showSaveDialog: mocks.showSaveDialog },
  nativeImage: { createFromBuffer: vi.fn() },
  shell: { openExternal: vi.fn(), showItemInFolder: mocks.showItemInFolder },
}))
vi.mock('../../src/main/ipc-boundary', () => ({
  handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
}))
vi.mock('../../src/main/config', () => ({ loadConfig: () => mocks.config, saveConfig: vi.fn(), getDataDir: () => root }))
vi.mock('../../src/main/settings-changes', () => ({ applyChangedFields: vi.fn() }))
vi.mock('../../src/main/session', () => ({ getSessionDir: () => mocks.sessionDir }))
vi.mock('../../src/main/logger', () => ({ log: vi.fn(), serializeError: (error: unknown) => ({ error }) }))

const { registerSettingsIpc } = await import('../../src/main/settings-ipc')

function invoke(channel: string, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`${channel} was not registered`)
  return handler({ sender: {} }, ...args)
}

let root: string

beforeEach(() => {
  vi.clearAllMocks()
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-picker-'))
  mocks.sessionDir = path.join(root, 'session')
  mocks.desktop = path.join(root, 'Desktop')
  fs.mkdirSync(mocks.sessionDir, { recursive: true })
  fs.mkdirSync(mocks.desktop, { recursive: true })
  mocks.config = { general: { export_dir: '' } } as AppConfig
  mocks.owner = null
  mocks.handlers.clear()
  registerSettingsIpc()
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('contextual native pickers', () => {
  it('uses the export draft, falls back to Desktop for an empty draft and preserves cancellation', async () => {
    mocks.config.general.export_dir = '/saved/export'
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    const draft = path.join(root, 'Draft')
    fs.mkdirSync(draft)
    await expect(invoke('dialog:openDirectory', draft)).resolves.toBeNull()
    expect(mocks.showOpenDialog).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: draft }))
    await invoke('dialog:openDirectory', '')
    expect(mocks.showOpenDialog).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: mocks.desktop }))
  })

  it('expands authored settings paths and uses an existing ancestor without creating the proposal', async () => {
    vi.stubEnv('IMAGEQUEUE_PICKER_TEST', root)
    try {
      mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
      await invoke('dialog:openDirectory', '$IMAGEQUEUE_PICKER_TEST/missing/nested')
      expect(mocks.showOpenDialog).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: root }))
      expect(fs.existsSync(path.join(root, 'missing'))).toBe(false)
      const sound = path.join(root, 'done.wav')
      fs.writeFileSync(sound, 'RIFF')
      const filters = [{ name: 'Audio', extensions: ['wav'] }]
      await invoke('dialog:openFile', filters, '%IMAGEQUEUE_PICKER_TEST%/done.wav')
      expect(mocks.showOpenDialog).toHaveBeenLastCalledWith(expect.objectContaining({ filters, defaultPath: sound }))
    } finally { vi.unstubAllEnvs() }
  })

  it('keeps blank imports generic and selected paths literal, owned by their window', async () => {
    const selected = path.join(root, ' $IMAGEQUEUE_PICKER_TEST%LITERAL% ')
    mocks.owner = { id: 'owner' }
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [selected] })
    await expect(invoke('dialog:openFile', [], '', 'model-import')).resolves.toBe(selected)
    expect(mocks.showOpenDialog).toHaveBeenLastCalledWith(mocks.owner, { properties: ['openFile'], filters: [] })
    fs.writeFileSync(selected, '')
    await invoke('dialog:openFile', [], selected, 'model-import')
    expect(mocks.showOpenDialog).toHaveBeenLastCalledWith(mocks.owner, expect.objectContaining({ defaultPath: selected }))
  })

  it('reuses literal selected export and sound paths and expands explicitly typed absolute hints', async () => {
    vi.stubEnv('IMAGEQUEUE_PICKER_TEST', 'expanded')
    try {
      const selected = path.join(root, '$IMAGEQUEUE_PICKER_TEST%IMAGEQUEUE_PICKER_TEST% ')
      fs.mkdirSync(selected)
      const sound = path.join(selected, 'done.wav')
      fs.writeFileSync(sound, 'RIFF')
      mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [selected] })
      const picked = await invoke('dialog:openDirectory', '')
      await invoke('dialog:openDirectory', picked)
      expect(mocks.showOpenDialog).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: selected }))
      mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [sound] })
      const pickedSound = await invoke('dialog:openFile', [])
      await invoke('dialog:openFile', [], pickedSound)
      expect(mocks.showOpenDialog).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: sound }))
      const expanded = path.join(root, 'expanded')
      fs.mkdirSync(expanded)
      const expression = path.join(root, '$IMAGEQUEUE_PICKER_TEST')
      await invoke('dialog:openDirectory', expression, true)
      expect(mocks.showOpenDialog).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: expanded }))
      await invoke('dialog:openFile', [], expression, undefined, true)
      expect(mocks.showOpenDialog).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: expanded }))
    } finally { vi.unstubAllEnvs() }
  })

  it.each(['~', '.', 'missing-model.ckpt'])('anchors authored model-import hints at Home: %s', async (source) => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await invoke('dialog:openFile', [], source, 'model-import')
    expect(mocks.showOpenDialog).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: os.homedir() }))
  })
})
