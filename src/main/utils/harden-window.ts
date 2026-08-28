import type { BrowserWindow } from 'electron'

// Defense-in-depth navigation lockdown applied to every app window. The app is a
// single-page renderer that never opens new windows and never navigates its top
// frame (external links go through shell.openExternal over IPC), so denying both
// window.open and every top-level navigation keeps a future bug, compromised
// renderer, or unhandled file/URL drop from replacing the app. Programmatic app
// loads and reloads do not emit will-navigate, so they remain available.
export function hardenWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
}
