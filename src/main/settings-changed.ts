import type { BrowserWindow } from 'electron'

// The main process changed a setting outside the Settings form, such as
// closing the preview window turning its setting off; the main window reads
// its settings again.
export const SETTINGS_CHANGED_CHANNEL = 'settings:changed'

export function notifySettingsChanged(main: BrowserWindow | null): void {
  if (main && !main.isDestroyed()) main.webContents.send(SETTINGS_CHANGED_CHANNEL)
}
