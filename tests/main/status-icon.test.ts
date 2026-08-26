import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class FakeImage {
    template = false
    constructor(readonly source: string, readonly empty: boolean) {}
    isEmpty(): boolean { return this.empty }
    setTemplateImage(value: boolean): void { this.template = value }
  }

  class FakeTray {
    static instances: FakeTray[] = []
    destroyed = false
    image: FakeImage
    tooltip = ''
    menu: Array<Record<string, unknown>> = []
    listeners = new Map<string, () => void>()

    constructor(image: FakeImage) {
      this.image = image
      FakeTray.instances.push(this)
    }

    isDestroyed(): boolean { return this.destroyed }
    destroy(): void { this.destroyed = true }
    setImage(image: FakeImage): void { this.image = image }
    setToolTip(value: string): void { this.tooltip = value }
    setContextMenu(menu: Array<Record<string, unknown>>): void { this.menu = menu }
    on(event: string, listener: () => void): this { this.listeners.set(event, listener); return this }
    emit(event: string): void { this.listeners.get(event)?.() }
  }

  return {
    FakeImage,
    FakeTray,
    imageEmpty: false,
    imagePaths: [] as string[],
    themeHandlers: new Set<() => void>(),
    queueListener: null as ((state: { paused: boolean; generating: number; queued: number; interrupted: number }) => void) | null,
    unsubscribe: vi.fn(),
    log: vi.fn(),
  }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app' },
  Menu: { buildFromTemplate: (template: Array<Record<string, unknown>>) => template },
  nativeImage: {
    createFromPath: (source: string) => {
      mocks.imagePaths.push(source)
      return new mocks.FakeImage(source, mocks.imageEmpty)
    },
  },
  nativeTheme: {
    inForcedColorsMode: false,
    shouldUseHighContrastColors: false,
    shouldUseDarkColorsForSystemIntegratedUI: false,
    on: (_event: string, listener: () => void) => { mocks.themeHandlers.add(listener) },
    off: (_event: string, listener: () => void) => { mocks.themeHandlers.delete(listener) },
  },
  Tray: mocks.FakeTray,
}))

vi.mock('../../src/main/queue/publisher', () => ({
  subscribeQueueControlState: vi.fn((listener: typeof mocks.queueListener) => {
    mocks.queueListener = listener
    listener?.({ paused: false, generating: 0, queued: 0, interrupted: 0 })
    return mocks.unsubscribe
  }),
}))

vi.mock('../../src/main/logger', () => ({
  log: mocks.log,
  serializeError: (error: unknown) => String(error),
}))

const electron = await import('electron')
const mutableTheme = electron.nativeTheme as unknown as {
  inForcedColorsMode: boolean
  shouldUseHighContrastColors: boolean
  shouldUseDarkColorsForSystemIntegratedUI: boolean
}
const {
  StatusIconController,
  buildStatusIconTooltip,
  statusIconAssetName,
} = await import('../../src/main/status-icon')

beforeEach(() => {
  mocks.FakeTray.instances.length = 0
  mocks.imagePaths.length = 0
  mocks.themeHandlers.clear()
  mocks.queueListener = null
  mocks.imageEmpty = false
  mocks.unsubscribe.mockClear()
  mocks.log.mockClear()
  mutableTheme.inForcedColorsMode = false
  mutableTheme.shouldUseHighContrastColors = false
  mutableTheme.shouldUseDarkColorsForSystemIntegratedUI = false
})

describe('status icon presentation', () => {
  it('selects platform and system-surface-specific assets', () => {
    expect(statusIconAssetName('darwin', 'dark')).toBe('ImageQueueStatusTemplate.png')
    expect(statusIconAssetName('win32', 'light')).toBe('ImageQueueStatusLight.ico')
    expect(statusIconAssetName('win32', 'dark')).toBe('ImageQueueStatusDark.ico')
    expect(statusIconAssetName('win32', 'high-contrast')).toBe('ImageQueueStatusHighContrast.ico')
    expect(statusIconAssetName('linux', 'dark')).toBeNull()
  })

  it('builds a compact tooltip from authoritative queue state', () => {
    expect(buildStatusIconTooltip({ paused: false, generating: 0, queued: 0, interrupted: 0 }))
      .toBe('ImageQueue — idle')
    expect(buildStatusIconTooltip({ paused: true, generating: 1, queued: 2, interrupted: 3 }))
      .toBe('ImageQueue — paused · 1 generating · 2 queued · 3 interrupted')
  })
})

describe('StatusIconController', () => {
  it('owns one Windows Tray and derives menu state from the queue subscription', async () => {
    const restore = vi.fn(async () => {})
    const setQueuePaused = vi.fn()
    const controller = new StatusIconController({
      platform: 'win32',
      restoreMainWindow: restore,
      requestQuit: vi.fn(),
      openOutputFolder: vi.fn(),
      setQueuePaused,
    })

    expect(await controller.reconcile(true)).toBe(true)
    expect(await controller.reconcile(true)).toBe(true)
    expect(mocks.FakeTray.instances).toHaveLength(1)
    const tray = mocks.FakeTray.instances[0]
    expect(tray.menu.map((item) => item.label).filter(Boolean)).toEqual([
      'Open ImageQueue', 'Open Output Folder', 'Pause', 'Exit ImageQueue',
    ])

    mocks.queueListener?.({ paused: true, generating: 1, queued: 2, interrupted: 0 })
    expect(tray.tooltip).toBe('ImageQueue — paused · 1 generating · 2 queued')
    const resume = tray.menu.find((item) => item.label === 'Resume')
    ;(resume?.click as (() => void))()
    expect(setQueuePaused).toHaveBeenCalledWith(false)

    tray.emit('click')
    expect(restore).toHaveBeenCalledOnce()
  })

  it('restores the window before destroying the only recovery icon', async () => {
    const order: string[] = []
    const controller = new StatusIconController({
      platform: 'win32',
      restoreMainWindow: async () => { order.push('restore') },
      requestQuit: vi.fn(),
      openOutputFolder: vi.fn(),
      setQueuePaused: vi.fn(),
    })
    await controller.reconcile(true)
    const tray = mocks.FakeTray.instances[0]
    const originalDestroy = tray.destroy.bind(tray)
    tray.destroy = () => { order.push('destroy'); originalDestroy() }

    await controller.reconcile(false)

    expect(order).toEqual(['restore', 'destroy'])
    expect(controller.isAvailable()).toBe(false)
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
  })

  it('keeps the icon when a newer enable wins an in-flight disable', async () => {
    let finishRestore!: () => void
    const restorePromise = new Promise<void>((resolve) => { finishRestore = resolve })
    const controller = new StatusIconController({
      platform: 'win32',
      restoreMainWindow: () => restorePromise,
      requestQuit: vi.fn(),
      openOutputFolder: vi.fn(),
      setQueuePaused: vi.fn(),
    })
    await controller.reconcile(true)

    const disabling = controller.reconcile(false)
    await controller.reconcile(true)
    finishRestore()
    await disabling

    expect(controller.isAvailable()).toBe(true)
    expect(mocks.FakeTray.instances[0].destroyed).toBe(false)
  })

  it('keeps the recovery icon when foreground restoration fails', async () => {
    const controller = new StatusIconController({
      platform: 'win32',
      restoreMainWindow: async () => { throw new Error('Dock unavailable') },
      requestQuit: vi.fn(),
      openOutputFolder: vi.fn(),
      setQueuePaused: vi.fn(),
    })
    await controller.reconcile(true)

    expect(await controller.reconcile(false)).toBe(true)
    expect(controller.isAvailable()).toBe(true)
    expect(mocks.log).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('main window was not restored'),
      expect.any(Object),
    )
  })

  it('swaps the Windows image when the system-integrated theme changes', async () => {
    const controller = new StatusIconController({
      platform: 'win32',
      restoreMainWindow: vi.fn(),
      requestQuit: vi.fn(),
      openOutputFolder: vi.fn(),
      setQueuePaused: vi.fn(),
    })
    await controller.reconcile(true)
    mutableTheme.shouldUseDarkColorsForSystemIntegratedUI = true
    for (const listener of mocks.themeHandlers) listener()

    expect(mocks.imagePaths.at(-1)).toMatch(/ImageQueueStatusDark\.ico$/)
    expect(mocks.FakeTray.instances[0].image.source).toMatch(/ImageQueueStatusDark\.ico$/)
  })

  it('uses a macOS template image and degrades safely when an asset is invalid', async () => {
    const mac = new StatusIconController({
      platform: 'darwin',
      restoreMainWindow: vi.fn(),
      requestQuit: vi.fn(),
      openOutputFolder: vi.fn(),
      setQueuePaused: vi.fn(),
    })
    expect(await mac.reconcile(true)).toBe(true)
    expect(mocks.FakeTray.instances[0].image.template).toBe(true)
    mac.dispose()

    mocks.imageEmpty = true
    const broken = new StatusIconController({
      platform: 'win32',
      restoreMainWindow: vi.fn(),
      requestQuit: vi.fn(),
      openOutputFolder: vi.fn(),
      setQueuePaused: vi.fn(),
    })
    expect(await broken.reconcile(true)).toBe(false)
    expect(broken.isAvailable()).toBe(false)
    expect(mocks.log).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('ordinary window lifecycle'),
      expect.any(Object),
    )
  })
})
