import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../../src/main/config/types'
import fs from 'fs'

type Handler = (...args: unknown[]) => unknown
type ConfigSaved = (config: AppConfig) => Promise<void> | void

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  config: {
    general: { show_status_icon: true },
  },
  saveConfig: vi.fn(),
  applyChangedFields: vi.fn(),
  log: vi.fn(),
  showItemInFolder: vi.fn(),
  openExternal: vi.fn(),
  readClipboardText: vi.fn(async () => ''),
  writeClipboard: vi.fn(),
  createFromBuffer: vi.fn((): { isEmpty: () => boolean; toPNG: () => Buffer } => ({
    isEmpty: () => false,
    toPNG: () => Buffer.from('png'),
  })),
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  ClipboardItem: class ClipboardItem {
    constructor(readonly items: Record<string, unknown>) {}
  },
  clipboard: { readText: mocks.readClipboardText, write: mocks.writeClipboard },
  dialog: { showOpenDialog: vi.fn() },
  nativeImage: { createFromPath: vi.fn(), createFromBuffer: mocks.createFromBuffer },
  shell: {
    openExternal: mocks.openExternal,
    showItemInFolder: mocks.showItemInFolder,
  },
}))

vi.mock('../../src/main/ipc-boundary', () => ({
  handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
}))

vi.mock('../../src/main/config', () => ({
  loadConfig: () => mocks.config,
  saveConfig: mocks.saveConfig,
}))

vi.mock('../../src/main/settings-changes', () => ({
  applyChangedFields: mocks.applyChangedFields,
}))

vi.mock('../../src/main/session', () => ({
  getSessionDir: () => '/session',
}))

vi.mock('../../src/main/logger', () => ({
  log: mocks.log,
  serializeError: (error: unknown) => ({ error }),
}))

const { registerSettingsIpc } = await import('../../src/main/settings-ipc')

function registerAndGetSaveHandler(onConfigSaved: ConfigSaved): Handler {
  mocks.handlers.clear()
  registerSettingsIpc(onConfigSaved)
  const handler = mocks.handlers.get('settings:saveChangedFields')
  if (!handler) throw new Error('settings save handler was not registered')
  return handler
}

beforeEach(() => {
  mocks.saveConfig.mockReset()
  mocks.applyChangedFields.mockReset()
  mocks.log.mockReset()
  mocks.showItemInFolder.mockReset()
  mocks.openExternal.mockReset()
  mocks.readClipboardText.mockReset()
  mocks.readClipboardText.mockResolvedValue('')
  mocks.writeClipboard.mockReset()
  mocks.createFromBuffer.mockReset()
  mocks.createFromBuffer.mockReturnValue({
    isEmpty: () => false,
    toPNG: () => Buffer.from('png'),
  })
})

describe('prompt image action preconditions', () => {
  it('rejects Reveal when the selected image no longer exists', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValueOnce(false)
    mocks.handlers.clear()
    registerSettingsIpc()
    const handler = mocks.handlers.get('shell:revealFile')
    expect(handler).toBeTruthy()

    expect(() => handler?.({}, 'image', 'png')).toThrow('Cannot reveal missing image')
    expect(mocks.showItemInFolder).not.toHaveBeenCalled()
  })

  it('rejects Copy to Clipboard when the image bytes cannot be decoded', async () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValueOnce(Buffer.from('not an image'))
    mocks.createFromBuffer.mockReturnValueOnce({
      isEmpty: () => true,
      toPNG: () => Buffer.from(''),
    })
    mocks.handlers.clear()
    registerSettingsIpc()
    const handler = mocks.handlers.get('clipboard:copyImage')
    expect(handler).toBeTruthy()

    await expect(handler?.({}, 'image', 'png')).rejects.toThrow('Cannot copy unreadable image')
    expect(mocks.writeClipboard).not.toHaveBeenCalled()
  })

  it('writes a copied image through the MIME-based clipboard API', async () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValueOnce(Buffer.from('source image'))
    mocks.handlers.clear()
    registerSettingsIpc()
    const handler = mocks.handlers.get('clipboard:copyImage')

    await expect(handler?.({}, 'image', 'webp')).resolves.toBeUndefined()
    const [items] = mocks.writeClipboard.mock.calls[0] as [{ items: Record<string, Blob> }[]]
    const blob = items[0]?.items['image/png']
    expect(blob?.type).toBe('image/png')
    await expect(blob?.text()).resolves.toBe('png')
  })

  it('awaits clipboard text before deciding whether text is available', async () => {
    mocks.readClipboardText.mockResolvedValueOnce('  copied text  ')
    mocks.handlers.clear()
    registerSettingsIpc()
    const handler = mocks.handlers.get('clipboard:hasText')

    await expect(handler?.({})).resolves.toBe(true)
  })
})

describe('external link transport', () => {
  it('keeps shell.openExternal rejection observable by the renderer caller', async () => {
    const hostile = new Error('IMAGEQUEUE_OPEN_EXTERNAL_SENTINEL')
    mocks.openExternal.mockRejectedValueOnce(hostile)
    mocks.handlers.clear()
    registerSettingsIpc()
    const handler = mocks.handlers.get('shell:openExternal')

    await expect(handler?.({}, 'https://example.com/model')).rejects.toBe(hostile)
    expect(mocks.openExternal).toHaveBeenCalledWith('https://example.com/model')
  })

  it('rejects unsupported protocols before they reach the OS shell', async () => {
    mocks.handlers.clear()
    registerSettingsIpc()
    const handler = mocks.handlers.get('shell:openExternal')

    await expect(handler?.({}, 'file:///private/tmp/secret')).rejects.toThrow('External URL scheme is not allowed')
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })
})

describe('status-icon reconciliation after a settings save', () => {
  it('runs only after the durable config write succeeds', async () => {
    const order: string[] = []
    mocks.saveConfig.mockImplementation(() => { order.push('save') })
    const reconcile = vi.fn(() => { order.push('reconcile') })
    const handler = registerAndGetSaveHandler(reconcile)

    await expect(handler({}, {}, {})).resolves.toEqual({ success: true })

    expect(order).toEqual(['save', 'reconcile'])
    expect(reconcile).toHaveBeenCalledWith(mocks.config)
  })

  it('does not reconcile when the config write fails', async () => {
    mocks.saveConfig.mockImplementation(() => { throw new Error('disk full') })
    const reconcile = vi.fn()
    const handler = registerAndGetSaveHandler(reconcile)

    await expect(handler({}, {}, {})).rejects.toThrow('disk full')
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('keeps a successful save successful when native reconciliation fails', async () => {
    const reconcile = vi.fn(() => { throw new Error('tray unavailable') })
    const handler = registerAndGetSaveHandler(reconcile)

    await expect(handler({}, {}, {})).resolves.toEqual({ success: true })
    expect(mocks.log).toHaveBeenCalledWith(
      'error',
      'Post-settings-save reconciliation failed',
      expect.any(Object),
    )
  })
})
