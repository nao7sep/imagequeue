import { BrowserWindow } from 'electron'

// Defense-in-depth navigation lockdown applied to every app window. The app is a
// single-page renderer that never opens new windows and never navigates its top
// frame (external links go through shell.openExternal over IPC), so denying both
// window.open and cross-origin navigation keeps a future bug — or a compromised
// renderer — from loading attacker content into a fresh, less-hardened context.
// Same-origin navigation (a dev-server reload) is left alone.
export function hardenWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    let target: URL
    let current: URL
    try {
      target = new URL(url)
      current = new URL(win.webContents.getURL())
    } catch {
      event.preventDefault()
      return
    }
    if (target.origin !== current.origin) event.preventDefault()
  })
}
