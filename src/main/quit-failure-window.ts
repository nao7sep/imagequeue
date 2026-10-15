import { BrowserWindow, ipcMain, screen } from 'electron'
import path from 'path'
import { mainTranslator } from './i18n'
import { hardenWindow } from './utils/harden-window'
import { trackThemedWindow, windowBackground } from './theme'
import type { QuitChoice } from './quit-handler'
import type { QuitQuestion } from '../shared/quit'

// The question the open quit window asks, read by its own page.
let asking: { contents: Electron.WebContents; question: QuitQuestion } | null = null
let questionIpcRegistered = false
function registerQuestionIpc(): void {
  if (questionIpcRegistered) return
  questionIpcRegistered = true
  ipcMain.handle('quit:question', (event) => (asking && event.sender === asking.contents ? asking.question : null))
}

/** A visible, unminimized window to attach the question to. A hidden window
 *  is never brought back to ask (window-conventions, Background mode). */
export function questionOwner(win: BrowserWindow | null | undefined): BrowserWindow | undefined {
  return win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() ? win : undefined
}

/** Standalone when no window is showing, so it works in background mode and
 * after the last window closed. OS takeover destroys it and settles the
 * question without choosing an action. */
export function showQuitQuestion(question: QuitQuestion, signal: AbortSignal, onSessionEnd: () => void, owner?: BrowserWindow): Promise<QuitChoice> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { resolve('cancel'); return }
    registerQuestionIpc()
    const t = mainTranslator().t
    const title = question.kind === 'saveFailed' ? t('quit.title')
      : t(question.platform === 'darwin' ? 'statusIcon.quit' : 'statusIcon.exit', { app: 'ImageQueue' })
    const parent = questionOwner(owner)
    const win = new BrowserWindow({
      ...(parent ? { parent, modal: true } : {}),
      title, width: Math.min(540, screen.getPrimaryDisplay().workArea.width), height: 240,
      show: false, resizable: false, minimizable: false, maximizable: false,
      fullscreenable: false, autoHideMenuBar: true, backgroundColor: windowBackground(),
      webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    hardenWindow(win)
    trackThemedWindow(win)
    asking = { contents: win.webContents, question }
    let settled = false
    let showTimer: ReturnType<typeof setTimeout> | undefined
    const finish = (choice: QuitChoice, error?: unknown): void => {
      if (settled) return
      settled = true
      if (asking?.contents === win.webContents) asking = null
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
      const choices = question.kind === 'saveFailed' ? ['retry', 'quit', 'cancel'] : ['quit', 'cancel']
      if (event.sender !== win.webContents || !choices.includes(String(choice))) return
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
