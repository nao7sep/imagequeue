export interface MainWindowLifecycleEvent {
  preventDefault(): void
}

export interface MainWindowLifecycleWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
  hide(): void
  setSkipTaskbar(skip: boolean): void
  on(event: 'close', listener: (event: MainWindowLifecycleEvent) => void): unknown
  on(event: 'closed', listener: () => void): unknown
  on(event: 'session-end', listener: () => void): unknown
}

export interface MainWindowDock {
  hide(): void
  show(): Promise<void>
}

interface MainWindowControllerOptions<TWindow extends MainWindowLifecycleWindow> {
  platform: NodeJS.Platform
  createWindow: () => TWindow
  isStatusIconAvailable: () => boolean
  closeViewerWindow: () => void
  onPrimaryWindowClosed: () => void
  dock?: MainWindowDock
  now?: () => number
}

const MAC_DOCK_HIDE_COOLDOWN_MS = 1_000

/** The one owner of ImageQueue's primary BrowserWindow and OS presence. */
export class MainWindowController<TWindow extends MainWindowLifecycleWindow> {
  private mainWindow: TWindow | null = null
  private startupComplete = false
  private shutdownStarted = false
  private systemSessionEnding = false
  private restoreInFlight: Promise<void> | null = null
  private dockHideTimer: ReturnType<typeof setTimeout> | null = null
  private dockHidden = false
  private lastDockShowAt = Number.NEGATIVE_INFINITY
  private readonly now: () => number

  constructor(private readonly options: MainWindowControllerOptions<TWindow>) {
    this.now = options.now ?? Date.now
  }

  getWindow(): TWindow | null {
    const win = this.mainWindow
    return win && !win.isDestroyed() ? win : null
  }

  createInitialWindow(): TWindow {
    const existing = this.getWindow()
    if (existing) return existing
    return this.createAndRegisterWindow()
  }

  markStartupComplete(): void {
    this.startupComplete = true
  }

  beginShutdown(): boolean {
    if (this.shutdownStarted) return false
    this.shutdownStarted = true
    this.cancelDockHide()
    return true
  }

  restoreOrCreate(): Promise<void> {
    if (this.restoreInFlight) return this.restoreInFlight

    const operation = this.restoreOrCreateInner()
    const tracked = operation.finally(() => {
      if (this.restoreInFlight === tracked) this.restoreInFlight = null
    })
    this.restoreInFlight = tracked
    return this.restoreInFlight
  }

  dispose(): void {
    this.cancelDockHide()
  }

  private createAndRegisterWindow(): TWindow {
    const win = this.options.createWindow()
    this.mainWindow = win

    win.on('close', (event) => {
      if (this.shutdownStarted || this.systemSessionEnding || !this.options.isStatusIconAvailable()) return
      event.preventDefault()
      this.options.closeViewerWindow()
      if (this.options.platform === 'win32') win.setSkipTaskbar(true)
      win.hide()
      if (this.options.platform === 'darwin') this.scheduleDockHide()
    })

    // Windows can deliver session-end before Electron begins its ordinary quit
    // sequence. Never turn an OS logoff/restart close into close-to-background;
    // releasing the primary window lets index.ts enter graceful shutdown.
    win.on('session-end', () => {
      this.systemSessionEnding = true
    })

    win.on('closed', () => {
      if (this.mainWindow !== win) return
      this.mainWindow = null
      this.options.closeViewerWindow()
      this.options.onPrimaryWindowClosed()
    })

    return win
  }

  private async restoreOrCreateInner(): Promise<void> {
    let win = this.getWindow()
    if (!win) {
      if (!this.startupComplete || this.shutdownStarted) return
      win = this.createAndRegisterWindow()
    }

    this.cancelDockHide()
    if (this.options.platform === 'darwin' && this.options.dock && this.dockHidden) {
      await this.options.dock.show()
      this.dockHidden = false
      this.lastDockShowAt = this.now()
    }

    // The window may have been destroyed while Dock restoration was awaiting.
    if (this.mainWindow !== win || win.isDestroyed() || this.shutdownStarted) return
    if (this.options.platform === 'win32') win.setSkipTaskbar(false)
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  private scheduleDockHide(): void {
    const dock = this.options.dock
    if (!dock) return
    this.cancelDockHide()

    const delay = Math.max(0, MAC_DOCK_HIDE_COOLDOWN_MS - (this.now() - this.lastDockShowAt))
    if (delay === 0) {
      dock.hide()
      this.dockHidden = true
      return
    }

    this.dockHideTimer = setTimeout(() => {
      this.dockHideTimer = null
      const win = this.getWindow()
      if (!this.shutdownStarted && this.options.isStatusIconAvailable() && win) {
        dock.hide()
        this.dockHidden = true
      }
    }, delay)
  }

  private cancelDockHide(): void {
    if (this.dockHideTimer === null) return
    clearTimeout(this.dockHideTimer)
    this.dockHideTimer = null
  }
}
