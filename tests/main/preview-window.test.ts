import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PREVIEW_WINDOW_MIN_HEIGHT, PREVIEW_WINDOW_MIN_WIDTH } from '../../src/shared/viewing'
import { SETTINGS_CHANGED_CHANNEL } from '../../src/main/settings-changed'

const mocks = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const state = {
    windows: [] as unknown[],
    config: { general: { show_preview_window: true } },
    recovered: vi.fn(),
    minimum: vi.fn(),
    saved: vi.fn(),
  }
  class FakeWindow extends EventEmitter {
    options: Record<string, unknown>
    destroyed = false
    visible = false
    focused = 0
    shownInactive = 0
    sent: string[] = []
    payloads: Array<[string, unknown]> = []
    loaded: unknown[] = []
    webContents = Object.assign(new EventEmitter(), {
      send: (channel: string, payload?: unknown) => {
        this.sent.push(channel)
        this.payloads.push([channel, payload])
      },
      setWindowOpenHandler: vi.fn(),
      replaceMisspelling: vi.fn(),
      isDestroyed: () => this.destroyed,
    })
    constructor(options: Record<string, unknown>) {
      super()
      this.options = options
      state.windows.push(this)
    }
    isDestroyed(): boolean { return this.destroyed }
    isVisible(): boolean { return this.visible }
    showInactive(): void { this.visible = true; this.shownInactive++ }
    hide(): void { this.visible = false }
    focus(): void { this.focused++ }
    destroy(): void {
      this.destroyed = true
      this.emit('closed')
    }
    // A close the user makes: Electron emits close, then closed.
    userClose(): void {
      this.emit('close', { preventDefault: vi.fn() })
      this.destroyed = true
      this.emit('closed')
    }
    async loadURL(url: string): Promise<void> { this.loaded.push(url) }
    async loadFile(file: string, options: unknown): Promise<void> { this.loaded.push([file, options]) }
  }
  return Object.assign(state, { FakeWindow })
})

type FakeWindow = InstanceType<typeof mocks.FakeWindow>

vi.mock('electron', () => ({ BrowserWindow: mocks.FakeWindow, Menu: { buildFromTemplate: vi.fn() } }))
vi.mock('../../src/main/i18n', () => ({ mainTranslator: () => ({ t: (key: string) => (key === 'previewWindow.title' ? 'Preview' : key) }) }))
vi.mock('../../src/main/theme', () => ({ trackThemedWindow: vi.fn(), windowBackground: () => '#e9eef7' }))
vi.mock('../../src/main/window-minimum', () => ({ configureWindowMinimum: mocks.minimum }))
vi.mock('../../src/main/utils/harden-window', () => ({ hardenWindow: vi.fn() }))
vi.mock('../../src/main/logger', () => ({ log: vi.fn(), serializeError: (error: unknown) => error }))
vi.mock('../../src/main/config', () => ({
  loadConfig: () => mocks.config,
  updateConfig: (apply: (draft: typeof mocks.config) => void) => {
    apply(mocks.config)
    mocks.saved(structuredClone(mocks.config))
    return mocks.config
  },
}))
vi.mock('../../src/main/window-state-recovery', () => ({
  createWindowWithUsablePersistedBounds: (name: string, create: () => unknown) => {
    mocks.recovered(name)
    return create()
  },
}))

let preview: typeof import('../../src/main/preview-window')
let snapshots: typeof import('../../src/main/selection-snapshot')
let main: FakeWindow

const previews = (): FakeWindow[] => (mocks.windows as FakeWindow[]).filter((win) => win !== main)

beforeEach(async () => {
  vi.resetModules()
  mocks.windows.length = 0
  mocks.config.general.show_preview_window = true
  mocks.recovered.mockClear()
  mocks.saved.mockClear()
  vi.stubEnv('ELECTRON_RENDERER_URL', undefined)
  preview = await import('../../src/main/preview-window')
  snapshots = await import('../../src/main/selection-snapshot')
  main = new mocks.FakeWindow({})
  preview.initPreviewWindow(() => main as unknown as Electron.BrowserWindow)
})

afterEach(() => {
  preview.closePreviewWindow()
  vi.unstubAllEnvs()
})

describe('preview window options', () => {
  it('is a durable window with its own placement, a minimum from its content, and no Spaces fullscreen', () => {
    expect(preview.buildPreviewWindowOptions('Preview')).toMatchObject({
      name: 'preview',
      title: 'Preview',
      windowStatePersistence: { bounds: true, displayMode: process.platform === 'win32' },
      minWidth: PREVIEW_WINDOW_MIN_WIDTH,
      minHeight: PREVIEW_WINDOW_MIN_HEIGHT,
      fullscreenable: false,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
  })
})

describe('the setting', () => {
  it('a background hide wins over a late ready-to-show, until explicitly restored', () => {
    preview.syncPreviewWindow(true)
    const [win] = previews()
    preview.hidePreviewWindow()
    win!.emit('ready-to-show')
    expect(win!.shownInactive).toBe(0)
    preview.showPreviewWindow()
    expect(win!.shownInactive).toBe(1)
  })

  it('opens one window on the preview surface when turned on, shown without taking focus', () => {
    preview.syncPreviewWindow(true)
    preview.syncPreviewWindow(true)
    const [win] = previews()
    expect(previews()).toHaveLength(1)
    expect(mocks.recovered).toHaveBeenCalledWith('preview')
    expect(win!.loaded).toEqual([[expect.stringMatching(/renderer[/\\]index\.html$/), { query: { surface: 'preview-window' } }]])
    win!.emit('ready-to-show')
    expect(win!.shownInactive).toBe(1)
    expect(win!.focused).toBe(0)
  })

  it('closes the window when turned off, leaving the setting as saved', () => {
    preview.syncPreviewWindow(true)
    preview.syncPreviewWindow(false)
    expect(previews()[0]!.destroyed).toBe(true)
    expect(mocks.saved).not.toHaveBeenCalled()
    expect(preview.previewWindowContents()).toBeNull()
  })

  it('turns the setting off when the user closes the window, and tells the main window', async () => {
    preview.syncPreviewWindow(true)
    previews()[0]!.userClose()
    await Promise.resolve()
    expect(mocks.saved).toHaveBeenCalledWith({ general: { show_preview_window: false } })
    expect(main.sent).toEqual([SETTINGS_CHANGED_CHANNEL])
  })

  it('leaves the setting on when a Windows logoff or restart closes the window', async () => {
    preview.syncPreviewWindow(true)
    previews()[0]!.emit('session-end')
    previews()[0]!.userClose()
    await Promise.resolve()
    expect(mocks.saved).not.toHaveBeenCalled()
  })
})

describe('following the selection', () => {
  it('sends each published selection to the window\'s page, hidden too', () => {
    snapshots.publishSelection(null)
    preview.syncPreviewWindow(true)
    const [win] = previews()
    win!.emit('ready-to-show')
    const task = { taskId: 'a', status: 'completed', baseName: 'a', error: null, providerMessage: null } as const
    snapshots.publishSelection(task)
    preview.hidePreviewWindow()
    snapshots.publishSelection(null)
    expect(win!.payloads).toEqual([
      [snapshots.SELECTION_SNAPSHOT_CHANNEL, { version: 2, task }],
      [snapshots.SELECTION_SNAPSHOT_CHANNEL, { version: 3, task: null }],
    ])
  })
})

describe('a lost renderer', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  const gone = (win: FakeWindow) => win.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })

  it('answers no for its confirmation and opens the window again, leaving the setting on', async () => {
    const confirms = await import('../../src/main/surface-confirm')
    preview.syncPreviewWindow(true)
    const [win] = previews()
    win!.emit('ready-to-show')
    await settle()
    const answer = confirms.askSurface('preview-window', win!.webContents as unknown as Electron.WebContents, { message: 'Delete?' })
    gone(win!)
    await expect(answer).resolves.toBe(false)
    expect(win!.destroyed).toBe(true)
    expect(mocks.saved).not.toHaveBeenCalled()
    const [, reopened] = previews()
    expect(reopened?.destroyed).toBe(false)
    expect(reopened?.loaded).toEqual([[expect.stringMatching(/renderer[/\\]index\.html$/), { query: { surface: 'preview-window' } }]])
  })

  it('waits for the main window to return when the window was hidden or its page had not loaded', async () => {
    preview.syncPreviewWindow(true)
    previews()[0]!.emit('ready-to-show')
    gone(previews()[0]!)
    expect(previews()).toHaveLength(1)

    preview.showPreviewWindow()
    const [, second] = previews()
    second!.emit('ready-to-show')
    await settle()
    preview.hidePreviewWindow()
    gone(second!)
    expect(previews()).toHaveLength(2)
    expect(second!.destroyed).toBe(true)
    preview.showPreviewWindow()
    expect(previews().filter((win) => !win.destroyed)).toHaveLength(1)
  })
})

describe('following the main window', () => {
  it('hides with the main window and returns with it, without taking focus', () => {
    preview.syncPreviewWindow(true)
    const [win] = previews()
    win!.emit('ready-to-show')
    preview.hidePreviewWindow()
    expect(win!.visible).toBe(false)
    expect(preview.previewWindowContents()).toBeNull()
    preview.showPreviewWindow()
    expect(win!.visible).toBe(true)
    expect(win!.focused).toBe(0)
    expect(preview.previewWindowContents()).toBe(win!.webContents)
  })

  it('opens again with a new main window when the setting is on, and not when it is off', () => {
    preview.syncPreviewWindow(true)
    preview.closePreviewWindow()
    expect(mocks.saved).not.toHaveBeenCalled()
    preview.showPreviewWindow()
    expect(previews().filter((win) => !win.destroyed)).toHaveLength(1)

    preview.closePreviewWindow()
    mocks.config.general.show_preview_window = false
    preview.showPreviewWindow()
    expect(previews().filter((win) => !win.destroyed)).toHaveLength(0)
  })
})
