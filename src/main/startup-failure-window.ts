import { BrowserWindow } from 'electron'
import path from 'path'
import { STARTUP_FAILURE_TITLE } from '../shared/startup-failure'
import { hardenWindow } from './utils/harden-window'

/** Creates ImageQueue's app-authored fatal-startup surface without a native alert icon. */
export function createStartupFailureWindow(message: string): BrowserWindow {
  const win = new BrowserWindow({
    title: STARTUP_FAILURE_TITLE,
    width: 520,
    height: 280,
    minWidth: 420,
    minHeight: 240,
    backgroundColor: '#1a1a2e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  hardenWindow(win)

  if (process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    url.searchParams.set('surface', 'startup-failure')
    url.searchParams.set('message', message)
    void win.loadURL(url.toString())
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { surface: 'startup-failure', message },
    })
  }

  return win
}
