import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MainWindowController,
  type MainWindowLifecycleEvent,
} from '../../src/main/main-window-lifecycle'

function makeWindow(options: { destroyed?: boolean; minimized?: boolean } = {}) {
  let closeListener: ((event: MainWindowLifecycleEvent) => void) | null = null
  let closedListener: (() => void) | null = null
  let sessionEndListener: (() => void) | null = null
  const nativeListeners: Record<string, () => void> = {}
  let readyListener: (() => void) | null = null
  const win = {
    isDestroyed: vi.fn(() => options.destroyed ?? false),
    isMinimized: vi.fn(() => options.minimized ?? false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    hide: vi.fn(),
    setSkipTaskbar: vi.fn(),
    on: vi.fn((event: 'close' | 'closed' | 'session-end' | 'query-session-end' | 'ready-to-show' | 'hide' | 'minimize', listener: ((event: MainWindowLifecycleEvent) => void) | (() => void)) => {
      if (event === 'close') closeListener = listener as (event: MainWindowLifecycleEvent) => void
      else if (event === 'closed') closedListener = listener as () => void
      else if (event === 'session-end') sessionEndListener = listener as () => void
      else if (event === 'ready-to-show') readyListener = listener as () => void
      else nativeListeners[event] = listener as () => void
    }),
    emitClose: () => {
      const event = { preventDefault: vi.fn() }
      closeListener?.(event)
      return event
    },
    emitClosed: () => { closedListener?.() },
    emitSessionEnd: () => { sessionEndListener?.() },
    emitNative: (event: string) => { nativeListeners[event]?.() },
    emitReady: () => { readyListener?.() },
  }
  return win
}

function makeController(options: {
  platform?: NodeJS.Platform
  statusAvailable?: () => boolean
  dock?: { hide: () => void; show: () => Promise<void> }
  window?: ReturnType<typeof makeWindow>
} = {}) {
  const win = options.window ?? makeWindow()
  const createWindow = vi.fn(() => win)
  const onHiddenToBackground = vi.fn()
  const onRestored = vi.fn()
  const onPrimaryWindowClosed = vi.fn()
  const controller = new MainWindowController({
    platform: options.platform ?? 'win32',
    createWindow,
    isStatusIconAvailable: options.statusAvailable ?? (() => true),
    onHiddenToBackground,
    onRestored,
    onPrimaryWindowClosed,
    dock: options.dock,
  })
  return { controller, win, createWindow, onHiddenToBackground, onRestored, onPrimaryWindowClosed }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('MainWindowController', () => {
  it.each(['hide', 'minimize', 'query-session-end'])('does not show after a later %s event', async (event) => {
    const { controller, win } = makeController()
    controller.createInitialWindow()
    win.emitNative(event)
    win.emitReady()
    expect(win.show).not.toHaveBeenCalled()
    if (event === 'query-session-end') {
      await controller.restoreOrCreate()
      expect(win.focus).not.toHaveBeenCalled()
    }
  })

  it('a later close defeats pending Dock restoration and late ready-to-show', async () => {
    let finish!: () => void
    const dock = { hide: vi.fn(), show: vi.fn(() => new Promise<void>((resolve) => { finish = resolve })) }
    const { controller, win } = makeController({ platform: 'darwin', dock })
    controller.createInitialWindow()
    controller.markStartupComplete()
    win.emitClose()
    const opening = controller.restoreOrCreate()
    win.emitClose()
    win.emitReady()
    finish()
    await opening
    expect(win.show).not.toHaveBeenCalled()
    expect(win.focus).not.toHaveBeenCalled()
  })

  it('honors the latest explicit activation after a close during pending Dock restoration', async () => {
    let finish!: () => void
    const dock = { hide: vi.fn(), show: vi.fn(() => new Promise<void>((resolve) => { finish = resolve })) }
    const { controller, win } = makeController({ platform: 'darwin', dock })
    controller.createInitialWindow()
    controller.markStartupComplete()
    win.emitClose()
    const first = controller.restoreOrCreate()
    win.emitClose()
    const latest = controller.restoreOrCreate()
    expect(latest).toBe(first)
    finish()
    await latest
    expect(dock.show).toHaveBeenCalledOnce()
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
  })

  it('makes a hidden app explicitly activatable without revealing it', async () => {
    const dock = { hide: vi.fn(), show: vi.fn(async () => {}) }
    const { controller, win } = makeController({ platform: 'darwin', dock })
    controller.createInitialWindow()
    win.emitClose()
    await controller.retainActivationSurface()
    expect(dock.show).toHaveBeenCalledOnce()
    expect(win.show).not.toHaveBeenCalled()
    expect(win.focus).not.toHaveBeenCalled()
  })
  it('does not create a competing window while startup is incomplete', async () => {
    const { controller, createWindow } = makeController()
    await controller.restoreOrCreate()
    expect(createWindow).not.toHaveBeenCalled()
  })

  it('creates one initial window and restores that same minimized instance', async () => {
    const win = makeWindow({ minimized: true })
    const { controller, createWindow } = makeController({ window: win })
    expect(controller.createInitialWindow()).toBe(win)
    controller.markStartupComplete()

    await controller.restoreOrCreate()

    expect(createWindow).toHaveBeenCalledOnce()
    expect(win.restore).toHaveBeenCalledOnce()
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
  })

  it('hides instead of destroying on Windows only while a recovery icon exists', async () => {
    let available = true
    const { controller, win, onHiddenToBackground, onRestored } = makeController({
      statusAvailable: () => available,
    })
    controller.createInitialWindow()
    controller.markStartupComplete()

    const hidden = win.emitClose()
    expect(hidden.preventDefault).toHaveBeenCalledOnce()
    expect(onHiddenToBackground).toHaveBeenCalledOnce()
    expect(win.setSkipTaskbar).toHaveBeenCalledWith(true)
    expect(win.hide).toHaveBeenCalledOnce()

    await controller.restoreOrCreate()
    expect(controller.getWindow()).toBe(win)
    expect(win.setSkipTaskbar).toHaveBeenLastCalledWith(false)
    expect(win.show).toHaveBeenCalledOnce()
    expect(onRestored).toHaveBeenCalledOnce()

    available = false
    const ordinaryClose = win.emitClose()
    expect(ordinaryClose.preventDefault).not.toHaveBeenCalled()
    expect(win.hide).toHaveBeenCalledOnce()
  })

  it('releases the primary window only after an ordinary close', () => {
    const { controller, win, onHiddenToBackground, onPrimaryWindowClosed } = makeController({
      statusAvailable: () => false,
    })
    controller.createInitialWindow()
    win.emitClosed()

    expect(controller.getWindow()).toBeNull()
    expect(onHiddenToBackground).not.toHaveBeenCalled()
    expect(onPrimaryWindowClosed).toHaveBeenCalledOnce()
  })

  it('ignores a stale closed event after a replacement window is adopted', async () => {
    const oldWindow = makeWindow({ destroyed: true })
    const replacement = makeWindow()
    const createWindow = vi.fn()
      .mockReturnValueOnce(oldWindow)
      .mockReturnValueOnce(replacement)
    const onPrimaryWindowClosed = vi.fn()
    const controller = new MainWindowController({
      platform: 'win32',
      createWindow,
      isStatusIconAvailable: () => false,
      onHiddenToBackground: vi.fn(),
      onRestored: vi.fn(),
      onPrimaryWindowClosed,
    })
    controller.createInitialWindow()
    controller.markStartupComplete()
    await controller.restoreOrCreate()

    oldWindow.emitClosed()

    expect(controller.getWindow()).toBe(replacement)
    expect(onPrimaryWindowClosed).not.toHaveBeenCalled()
  })

  it('never converts explicit quit into backgrounding', () => {
    const { controller, win } = makeController()
    controller.createInitialWindow()
    expect(controller.isShuttingDown()).toBe(false)
    expect(controller.beginShutdown()).toBe(true)
    expect(controller.isShuttingDown()).toBe(true)
    expect(controller.beginShutdown()).toBe(false)

    const event = win.emitClose()
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(win.hide).not.toHaveBeenCalled()
  })

  it('never converts a Windows logoff or restart close into backgrounding', () => {
    const { controller, win } = makeController()
    controller.createInitialWindow()

    win.emitSessionEnd()
    const event = win.emitClose()

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(win.setSkipTaskbar).not.toHaveBeenCalled()
    expect(win.hide).not.toHaveBeenCalled()
  })

  it('hides the macOS Dock only in background and shows it before the window', async () => {
    const order: string[] = []
    const dock = {
      hide: vi.fn(() => { order.push('dock-hide') }),
      show: vi.fn(async () => { order.push('dock-show') }),
    }
    const win = makeWindow()
    win.show.mockImplementation(() => { order.push('window-show') })
    const { controller } = makeController({ platform: 'darwin', dock, window: win })
    controller.createInitialWindow()
    controller.markStartupComplete()

    win.emitClose()
    expect(dock.hide).toHaveBeenCalledOnce()
    await controller.restoreOrCreate()

    expect(order.slice(-2)).toEqual(['dock-show', 'window-show'])
  })

  it('cancels a delayed Dock hide when restoration wins a rapid close/restore race', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const dock = { hide: vi.fn(), show: vi.fn(async () => {}) }
    const win = makeWindow()
    const { controller } = makeController({ platform: 'darwin', dock, window: win })
    controller.createInitialWindow()
    controller.markStartupComplete()

    win.emitClose()
    await controller.restoreOrCreate()
    win.emitClose()
    expect(dock.hide).toHaveBeenCalledOnce()

    await controller.restoreOrCreate()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(dock.hide).toHaveBeenCalledOnce()
  })
})
