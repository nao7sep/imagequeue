// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  general: { ui_font_family: '' },
}))

class FakeBrowserWindow {
  static instances: FakeBrowserWindow[] = []
  private closed: (() => void) | undefined
  private destroyed = false
  showInactive = vi.fn()
  hide = vi.fn()
  setBounds = vi.fn()
  webContents = {
    executeJavaScript: vi.fn(async (source: string) => window.eval(source) as unknown),
  }

  constructor() { FakeBrowserWindow.instances.push(this) }

  on(_event: string, listener: () => void): void { this.closed = listener }
  isDestroyed(): boolean { return this.destroyed }
  async loadURL(url: string): Promise<void> {
    document.open()
    document.write(decodeURIComponent(url.slice(url.indexOf(',') + 1)))
    document.close()
  }
  destroy(): void {
    this.destroyed = true
    this.closed?.()
  }
}

vi.mock('electron', () => ({
  BrowserWindow: FakeBrowserWindow,
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1200, height: 800 } }) },
  dialog: {},
}))
vi.mock('../../src/main/ipc-boundary', () => ({
  handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
}))
vi.mock('../../src/main/config', () => ({
  loadConfig: () => ({ general: mocks.general }),
  getDataDir: vi.fn(),
}))
vi.mock('../../src/main/logger', () => ({ log: vi.fn(), serializeError: vi.fn() }))
vi.mock('../../src/main/utils/harden-window', () => ({ hardenWindow: vi.fn() }))
vi.mock('../../src/main/i18n', () => ({
  mainTranslator: () => ({ language: 'en', t: () => 'Complete' }),
}))

const { initNotificationWindow, closeNotificationWindow, registerNotificationIpc } = await import('../../src/main/notification')

beforeEach(() => {
  vi.useFakeTimers()
  FakeBrowserWindow.instances = []
  mocks.handlers.clear()
  mocks.general.ui_font_family = ''
  registerNotificationIpc()
})

afterEach(() => {
  closeNotificationWindow()
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.replaceChildren()
})

it('clears the reused toast font and measures with the default font after the setting is cleared', async () => {
  const measuredFonts: string[] = []
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    measuredFonts.push(this.style.fontFamily)
    return { x: 0, y: 0, width: 200, height: 36, top: 0, right: 200, bottom: 36, left: 0, toJSON: () => ({}) }
  })
  initNotificationWindow()
  const win = FakeBrowserWindow.instances[0]
  const toast = document.getElementById('toast')!
  const show = mocks.handlers.get('notification:show')!

  mocks.general.ui_font_family = 'Georgia'
  show({}, 'success')
  await vi.advanceTimersByTimeAsync(0)
  expect(toast.style.fontFamily).toBe('Georgia')
  expect(measuredFonts).toEqual(['Georgia'])
  expect(win.showInactive).toHaveBeenCalledTimes(1)

  await vi.advanceTimersByTimeAsync(3000)
  expect(win.hide).toHaveBeenCalledTimes(1)
  mocks.general.ui_font_family = ''
  show({}, 'success')
  await vi.advanceTimersByTimeAsync(0)

  expect(document.getElementById('toast')).toBe(toast)
  expect(toast.style.fontFamily).toBe('')
  expect(measuredFonts).toEqual(['Georgia', ''])
  expect(win.showInactive).toHaveBeenCalledTimes(2)
  expect(FakeBrowserWindow.instances).toHaveLength(1)
})
