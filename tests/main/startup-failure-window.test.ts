import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { message } from '../../src/shared/i18n/translate'
import { STARTUP_FAILURE_MEASUREMENT_CHANNEL } from '../../src/shared/startup-failure'

const mocks = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    webContents = new EventEmitter()
    destroyed = false
    isDestroyed() { return this.destroyed }
    close = vi.fn(() => { this.destroyed = true; this.emit('closed') })
    getBounds() { return { x: 0, y: 0, width: 520, height: 1 } }
    setMinimumSize = vi.fn()
    setContentSize = vi.fn()
    show = vi.fn()
  }
  return { Window, ipcMain: new EventEmitter(), load: vi.fn(), showErrorBox: vi.fn() }
})
vi.mock('electron', () => ({
  BrowserWindow: mocks.Window, ipcMain: mocks.ipcMain,
  dialog: { showErrorBox: mocks.showErrorBox },
  screen: { getDisplayMatching: () => ({ workArea: { height: 900 } }) },
}))
vi.mock('../../src/main/renderer-surface', () => ({ PRELOAD_PATH: '', loadRendererSurface: mocks.load }))
vi.mock('../../src/main/ipc-boundary', () => ({ handle: vi.fn() }))
vi.mock('../../src/main/utils/harden-window', () => ({ hardenWindow: vi.fn() }))
vi.mock('../../src/main/theme', () => ({ trackThemedWindow: vi.fn(), windowBackground: () => '#fff' }))
vi.mock('../../src/main/logger', () => ({ log: vi.fn(), serializeError: String }))
vi.mock('../../src/main/i18n', () => ({ onLanguageChanged: () => () => {}, mainTranslator: () => ({ t: () => 'Cannot start', text: () => 'The saved settings cannot be read.' }) }))
const { createStartupFailureWindow } = await import('../../src/main/startup-failure-window')

beforeEach(() => { vi.clearAllMocks(); mocks.load.mockResolvedValue(undefined) })
afterEach(() => mocks.ipcMain.removeAllListeners())
const open = () => createStartupFailureWindow(message('startupFailure.title')) as unknown as InstanceType<typeof mocks.Window>

describe('startup failure fallback', () => {
  it('shows an independent authored message before closing when the failure page cannot load', async () => {
    mocks.load.mockRejectedValue(new Error('missing renderer assets'))
    const win = open()
    await Promise.resolve()
    expect(mocks.showErrorBox).toHaveBeenCalledWith('Cannot start', 'The saved settings cannot be read.')
    expect(mocks.showErrorBox.mock.invocationCallOrder[0]).toBeLessThan(win.close.mock.invocationCallOrder[0]!)
    expect(win.isDestroyed()).toBe(true)
    expect(mocks.ipcMain.listenerCount(STARTUP_FAILURE_MEASUREMENT_CHANNEL)).toBe(0)
  })

  it('presents renderer death once even if navigation also rejects', async () => {
    mocks.load.mockRejectedValue(new Error('navigation failed'))
    const win = open()
    win.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    await Promise.resolve()
    expect(mocks.showErrorBox).toHaveBeenCalledOnce()
    expect(win.close).toHaveBeenCalledOnce()
  })

  it('keeps the native fallback out of a working page and ordinary dismissal', async () => {
    const win = open()
    win.close()
    await Promise.resolve()
    expect(mocks.showErrorBox).not.toHaveBeenCalled()
  })

  it('does not silently close an unusable measurement response', () => {
    const win = open()
    mocks.ipcMain.emit(STARTUP_FAILURE_MEASUREMENT_CHANNEL, { sender: win.webContents }, null)
    expect(mocks.showErrorBox).toHaveBeenCalledOnce()
    expect(win.isDestroyed()).toBe(true)
  })
})
