import { BrowserWindow, Menu } from 'electron'
import path from 'path'
import { RECORDS_WINDOW_MIN_HEIGHT, RECORDS_WINDOW_MIN_WIDTH } from '../shared/records-layout'
import { buildTextContextMenuTemplate } from './app-menu'
import { mainTranslator } from './i18n'
import { log, serializeError } from './logger'
import { trackThemedWindow, windowBackground } from './theme'
import { hardenWindow } from './utils/harden-window'
import { configureWindowMinimum } from './window-minimum'
import { createWindowWithUsablePersistedBounds } from './window-state-recovery'

export const RECORDS_CHANGED_CHANNEL = 'records:changed'

// The Records window shows records.sqlite3. It is a durable secondary window
// with its own placement (window-conventions, Placement), and there is only
// ever one: opening it again brings it forward.
let recordsWindow: BrowserWindow | null = null

export function buildRecordsWindowOptions(title: string): Electron.BrowserWindowConstructorOptions {
  return {
    name: 'records',
    windowStatePersistence: {
      bounds: true,
      displayMode: process.platform === 'win32',
    },
    title,
    width: 1240,
    height: 820,
    minWidth: RECORDS_WINDOW_MIN_WIDTH,
    minHeight: RECORDS_WINDOW_MIN_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  }
}

/** Tells the Records window, when it is open, that a record was stored. */
export function notifyRecordsChanged(): void {
  if (recordsWindow && !recordsWindow.isDestroyed()) {
    recordsWindow.webContents.send(RECORDS_CHANGED_CHANNEL)
  }
}

export async function openRecordsWindow(): Promise<void> {
  if (recordsWindow && !recordsWindow.isDestroyed()) {
    if (recordsWindow.isMinimized()) recordsWindow.restore()
    recordsWindow.show()
    recordsWindow.focus()
    return
  }

  const options = buildRecordsWindowOptions(mainTranslator().t('records.title'))
  const win = createWindowWithUsablePersistedBounds('records', () => new BrowserWindow({
    ...options,
    backgroundColor: windowBackground(),
  }))
  recordsWindow = win
  win.once('closed', () => {
    if (recordsWindow === win) recordsWindow = null
  })
  hardenWindow(win)
  trackThemedWindow(win)
  configureWindowMinimum(win, () => ({ width: RECORDS_WINDOW_MIN_WIDTH, height: RECORDS_WINDOW_MIN_HEIGHT }),
    (error) => log('warn', 'Window minimum could not be updated', { window: 'records', error: serializeError(error) }))
  win.webContents.on('context-menu', (_event, params) => {
    const template = buildTextContextMenuTemplate(mainTranslator(), params, (word) => win.webContents.replaceMisspelling(word))
    if (template) Menu.buildFromTemplate(template).popup({ window: win })
  })
  win.once('ready-to-show', () => {
    win.show()
  })

  try {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    if (rendererUrl) {
      const url = new URL(rendererUrl)
      url.searchParams.set('surface', 'records')
      await win.loadURL(url.toString())
    } else {
      await win.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { surface: 'records' } })
    }
  } catch (error) {
    if (!win.isDestroyed()) win.destroy()
    throw error
  }
}

/** Closes the Records window on quit. */
export function closeRecordsWindow(): void {
  const win = recordsWindow
  recordsWindow = null
  if (win && !win.isDestroyed()) win.destroy()
}
