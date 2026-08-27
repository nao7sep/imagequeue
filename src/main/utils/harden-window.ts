import type { BrowserWindow } from 'electron'

export function isAllowedTopLevelNavigation(targetUrl: string, currentUrl: string): boolean {
  return targetUrl === currentUrl
}

// Defense-in-depth navigation lockdown applied to every app window. The app is a
// single-page renderer that never opens new windows and never navigates its top
// frame (external links go through shell.openExternal over IPC), so denying both
// window.open and every top-level navigation keeps a future bug, compromised
// renderer, or unhandled file/URL drop from replacing the app. An exact reload
// of the current URL remains available to the development server.
export function hardenWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedTopLevelNavigation(url, win.webContents.getURL())) event.preventDefault()
  })
}
