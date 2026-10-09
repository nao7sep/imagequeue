import { BrowserWindow, ipcMain, screen } from 'electron'
import path from 'path'
import { mainTranslator } from './i18n'
import { hardenWindow } from './utils/harden-window'
import { trackThemedWindow, windowBackground } from './theme'
import type { QuitChoice } from './quit-handler'

/** Standalone ownership works even after macOS's last main window closed.
 * OS takeover destroys it and settles the question without choosing an action. */
export function showQuitFailure(signal: AbortSignal, onSessionEnd: () => void, owner?: BrowserWindow): Promise<QuitChoice> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { resolve('cancel'); return }
    const win = new BrowserWindow({
      ...(owner && !owner.isDestroyed() ? { parent: owner, modal: true } : {}),
      title: mainTranslator().t('quit.title'), width: Math.min(540, screen.getPrimaryDisplay().workArea.width), height: 240,
      show: false, resizable: false, minimizable: false, maximizable: false,
      fullscreenable: false, autoHideMenuBar: true, backgroundColor: windowBackground(),
      webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    hardenWindow(win)
    trackThemedWindow(win)
    let settled = false
    let showTimer: ReturnType<typeof setTimeout> | undefined
    const finish = (choice: QuitChoice, error?: unknown): void => {
      if (settled) return
      settled = true
      clearTimeout(showTimer)
      signal.removeEventListener('abort', abort)
      ipcMain.removeListener('quit:choice', choose)
      ipcMain.removeListener('quit:height', measure)
      if (!win.isDestroyed()) win.destroy()
      if (error) reject(error)
      else resolve(choice)
    }
    const abort = (): void => finish('cancel')
    const choose = (event: Electron.IpcMainEvent, choice: unknown): void => {
      if (event.sender !== win.webContents || !['retry', 'quit', 'cancel'].includes(String(choice))) return
      finish(choice as QuitChoice)
    }
    const measure = (event: Electron.IpcMainEvent, height: unknown): void => {
      if (event.sender !== win.webContents || typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return
      clearTimeout(showTimer)
      const workArea = screen.getDisplayMatching(win.getBounds()).workArea
      win.setContentSize(Math.min(540, workArea.width), Math.min(Math.ceil(height), Math.floor(workArea.height * 0.85)))
      win.center()
      win.show()
    }
    ipcMain.on('quit:choice', choose)
    ipcMain.on('quit:height', measure)
    signal.addEventListener('abort', abort, { once: true })
    win.on('query-session-end', onSessionEnd)
    win.on('session-end', onSessionEnd)
    showTimer = setTimeout(() => finish('cancel', new Error('The quit question could not be shown')), 10_000)
    win.on('closed', () => finish('cancel'))
    win.webContents.on('render-process-gone', (_event, details) => finish('cancel', new Error(`Quit question renderer exited: ${details.reason}`)))
    const loaded = process.env['ELECTRON_RENDERER_URL']
      ? win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?surface=quit-failure`)
      : win.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { surface: 'quit-failure' } })
    void loaded.catch((error) => finish('cancel', error))
  })
}
