import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const state = {
    windows: [] as unknown[],
    primary: { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 } },
    external: { id: 2, bounds: { x: 1440, y: 0, width: 2560, height: 1440 } },
    matching: vi.fn(),
  }
  class FakeWindow extends EventEmitter {
    options: Record<string, unknown>
    destroyed = false
    visible = false
    minimized = false
    level: unknown[] = []
    bounds: unknown = null
    focused = 0
    sent: Array<[string, unknown]> = []
    loaded: unknown[] = []
    webContents = Object.assign(new EventEmitter(), {
      send: (channel: string, payload?: unknown) => { this.sent.push([channel, payload]) },
      setWindowOpenHandler: vi.fn(),
      isDestroyed: () => this.destroyed,
    })
    constructor(options: Record<string, unknown>) {
      super()
      this.options = options
      state.windows.push(this)
    }
    isDestroyed(): boolean { return this.destroyed }
    isMinimized(): boolean { return this.minimized }
    isVisible(): boolean { return this.visible }
    getBounds(): unknown { return { x: 1500, y: 100, width: 800, height: 600 } }
    setBounds(bounds: unknown): void { this.bounds = bounds }
    setAlwaysOnTop(...args: unknown[]): void { this.level = args }
    show(): void { this.visible = true }
    hide(): void { this.visible = false }
    focus(): void { this.focused++ }
    restore(): void { this.minimized = false }
    destroy(): void {
      this.destroyed = true
      this.emit('closed')
    }
    async loadURL(url: string): Promise<void> { this.loaded.push(url) }
    async loadFile(file: string, options: unknown): Promise<void> { this.loaded.push([file, options]) }
  }
  return Object.assign(state, { FakeWindow })
})

type FakeWindow = InstanceType<typeof mocks.FakeWindow>

vi.mock('electron', () => ({
  BrowserWindow: mocks.FakeWindow,
  screen: {
    getDisplayMatching: (bounds: unknown) => { mocks.matching(bounds); return mocks.external },
    getPrimaryDisplay: () => mocks.primary,
  },
}))
vi.mock('../../src/main/logger', () => ({ log: vi.fn(), serializeError: (error: unknown) => error }))
vi.mock('../../src/main/utils/harden-window', () => ({ hardenWindow: vi.fn() }))

let view: typeof import('../../src/main/fullscreen-view')
let snapshots: typeof import('../../src/main/selection-snapshot')
let main: FakeWindow | null

const views = (): FakeWindow[] => (mocks.windows as FakeWindow[]).filter((win) => win !== main)
const mainSent = (): string[] => main!.sent.map(([channel]) => channel)
const image = (baseName: string) => ({ taskId: baseName, status: 'completed' as const, baseName, error: null, providerMessage: null })

beforeEach(async () => {
  vi.resetModules()
  mocks.windows.length = 0
  mocks.matching.mockClear()
  vi.stubEnv('ELECTRON_RENDERER_URL', undefined)
  view = await import('../../src/main/fullscreen-view')
  snapshots = await import('../../src/main/selection-snapshot')
  main = new mocks.FakeWindow({})
  view.initFullscreenView(() => main as unknown as Electron.BrowserWindow)
})

afterEach(() => {
  view.destroyFullscreenView()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('fullscreen view window', () => {
  it('is borderless, never Spaces fullscreen, black, and above the Dock, menu bar and taskbar', async () => {
    snapshots.publishSelection(image('a'))
    void view.openFullscreenView()
    const [win] = views()
    expect(win!.options).toMatchObject({
      frame: false,
      fullscreenable: false,
      backgroundColor: '#000000',
      show: false,
      skipTaskbar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    expect(win!.level).toEqual([true, 'pop-up-menu'])
    expect(win!.options).not.toHaveProperty('kiosk')
    expect(win!.loaded).toEqual([[expect.stringMatching(/renderer[/\\]index\.html$/), { query: { surface: 'fullscreen-view' } }]])
  })

  it('covers the full frame of the display the main window is on, or the primary display without one', () => {
    expect(view.fullscreenViewDisplay(main as unknown as Electron.BrowserWindow)).toBe(mocks.external)
    expect(mocks.matching).toHaveBeenCalledWith({ x: 1500, y: 100, width: 800, height: 600 })
    expect(view.fullscreenViewDisplay(null)).toBe(mocks.primary)
    snapshots.publishSelection(image('a'))
    void view.openFullscreenView()
    expect(views()[0]!.options).toMatchObject(mocks.external.bounds)
  })
})

describe('opening and closing', () => {
  it('appears only once its page has painted the selected image, then follows the selection', async () => {
    const { version } = snapshots.publishSelection(image('a'))
    const opened = view.openFullscreenView()
    const [win] = views()
    expect(win!.visible).toBe(false)

    view.fullscreenViewPainted(version, true)
    await opened
    expect(win!.visible).toBe(true)
    expect(win!.focused).toBe(1)
    expect(mainSent()).toEqual([view.FULLSCREEN_VIEW_OPENED_CHANNEL])

    const next = snapshots.publishSelection(image('b'))
    expect(win!.sent.at(-1)).toEqual([snapshots.SELECTION_SNAPSHOT_CHANNEL, next])
  })

  it('reuses its window and shows at once when the selection has not changed since it last painted', async () => {
    const { version } = snapshots.publishSelection(image('a'))
    const first = view.openFullscreenView()
    view.fullscreenViewPainted(version, true)
    await first
    view.closeFullscreenView({ refocusMain: true })
    const [win] = views()
    expect(win!.visible).toBe(false)

    await view.openFullscreenView()
    expect(views()).toHaveLength(1)
    expect(win!.visible).toBe(true)
  })

  it('sends a changed selection to its hidden page and waits for that paint', async () => {
    const a = snapshots.publishSelection(image('a'))
    const first = view.openFullscreenView()
    view.fullscreenViewPainted(a.version, true)
    await first
    view.closeFullscreenView({ refocusMain: true })
    const [win] = views()
    win!.sent.length = 0
    const b = snapshots.publishSelection(image('b'))
    expect(win!.sent).toEqual([])

    const second = view.openFullscreenView()
    expect(win!.sent).toEqual([[snapshots.SELECTION_SNAPSHOT_CHANNEL, b]])
    expect(win!.visible).toBe(false)
    view.fullscreenViewPainted(b.version, true)
    await second
    expect(win!.visible).toBe(true)
  })

  it('drops a paint report older than the latest selection', async () => {
    const a = snapshots.publishSelection(image('a'))
    const opened = view.openFullscreenView()
    const b = snapshots.publishSelection(image('b'))
    view.fullscreenViewPainted(a.version, true)
    expect(views()[0]!.visible).toBe(false)
    view.fullscreenViewPainted(b.version, true)
    await opened
    expect(views()[0]!.visible).toBe(true)
  })

  it('closes when its page cannot paint the selection, and gives the main window back its focus', async () => {
    const a = snapshots.publishSelection(image('a'))
    const opened = view.openFullscreenView()
    view.fullscreenViewPainted(a.version, true)
    await opened
    const focusedBefore = main!.focused

    const none = snapshots.publishSelection(null)
    view.fullscreenViewPainted(none.version, false)
    expect(views()[0]!.visible).toBe(false)
    expect(mainSent()).toEqual([view.FULLSCREEN_VIEW_OPENED_CHANNEL, view.FULLSCREEN_VIEW_CLOSED_CHANNEL])
    expect(main!.focused).toBe(focusedBefore + 1)
  })

  it('closes when ImageQueue stops being the active app, without taking focus back', async () => {
    const a = snapshots.publishSelection(image('a'))
    const opened = view.openFullscreenView()
    view.fullscreenViewPainted(a.version, true)
    await opened
    const focusedBefore = main!.focused

    views()[0]!.emit('blur')
    expect(views()[0]!.visible).toBe(false)
    expect(mainSent().at(-1)).toBe(view.FULLSCREEN_VIEW_CLOSED_CHANNEL)
    expect(main!.focused).toBe(focusedBefore)
  })

  it('turns a close from the system into closing the view', async () => {
    const a = snapshots.publishSelection(image('a'))
    const opened = view.openFullscreenView()
    view.fullscreenViewPainted(a.version, true)
    await opened
    const event = { preventDefault: vi.fn() }
    views()[0]!.emit('close', event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(views()[0]!.visible).toBe(false)
    expect(views()[0]!.destroyed).toBe(false)
  })

  it('reports an open whose page never paints, within a bound', async () => {
    vi.useFakeTimers()
    snapshots.publishSelection(image('a'))
    const opened = view.openFullscreenView()
    const failed = expect(opened).rejects.toThrow(/did not paint/)
    await vi.advanceTimersByTimeAsync(5_000)
    await failed
    expect(views()[0]!.visible).toBe(false)
  })
})

describe('renderer failure', () => {
  it('closes on a lost renderer and opens a fresh window next time, never a black one', async () => {
    const a = snapshots.publishSelection(image('a'))
    const opened = view.openFullscreenView()
    view.fullscreenViewPainted(a.version, true)
    await opened
    const [gone] = views()

    gone!.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    expect(gone!.destroyed).toBe(true)
    expect(mainSent().at(-1)).toBe(view.FULLSCREEN_VIEW_CLOSED_CHANNEL)
    expect(view.fullscreenViewContents()).toBeNull()

    void view.openFullscreenView()
    expect(views().filter((win) => !win.destroyed)).toHaveLength(1)
    expect(views()).toHaveLength(2)
  })
})
