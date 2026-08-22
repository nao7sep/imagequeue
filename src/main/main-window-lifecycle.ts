interface MainWindowLifecycleWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

export function restoreOrCreateMainWindow(
  win: MainWindowLifecycleWindow | null,
  startupComplete: boolean,
  createWindow: () => void,
): void {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return
  }

  // A second launch can arrive while the first process is still starting. In
  // that case startUp() will create the initial window itself; creating here as
  // well would race that path. Once startup is complete, however, no live main
  // window means the user previously closed it on macOS and relaunch expects a
  // new one.
  if (startupComplete) createWindow()
}
