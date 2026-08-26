import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../../src/main/config/types'

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
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  clipboard: { readText: vi.fn(() => '') },
  dialog: { showOpenDialog: vi.fn() },
  nativeImage: { createFromPath: vi.fn() },
  shell: {
    openExternal: vi.fn(),
    showItemInFolder: vi.fn(),
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
