import { BrowserWindow, Menu } from 'electron'
import path from 'path'
import { PREVIEW_WINDOW_MIN_HEIGHT, PREVIEW_WINDOW_MIN_WIDTH } from '../shared/viewing'
import { buildTextContextMenuTemplate } from './app-menu'
import { loadConfig, updateConfig } from './config'
import { mainTranslator } from './i18n'
import { log, serializeError } from './logger'
import { loadRendererSurface } from './renderer-surface'
import { onSelectionPublished, SELECTION_SNAPSHOT_CHANNEL } from './selection-snapshot'
import { notifySettingsChanged } from './settings-changed'
import { dismissSurfaceConfirms } from './surface-confirm'
import { trackThemedWindow, windowBackground } from './theme'
import { hardenWindow } from './utils/harden-window'
import { configureWindowMinimum } from './window-minimum'
import { createWindowWithUsablePersistedBounds } from './window-state-recovery'

// The preview window: the preview again, in its own window, following the
// selection while the lists stay in the main window. It exists while the
// "Also show in a separate window" setting is on; closing it with its own
// button turns the setting off. A durable secondary window with its own
// placement (window-conventions, Placement). It never takes focus when it
// appears, so the keyboard stays in the main window.

let previewWindow: BrowserWindow | null = null
let getMainWin: () => BrowserWindow | null = () => null

export function buildPreviewWindowOptions(title: string): Electron.BrowserWindowConstructorOptions {
  return {
    name: 'preview',
    windowStatePersistence: {
      bounds: true,
      displayMode: process.platform === 'win32',
    },
    title,
    width: 640,
    height: 560,
    minWidth: PREVIEW_WINDOW_MIN_WIDTH,
    minHeight: PREVIEW_WINDOW_MIN_HEIGHT,
    // Only the fullscreen view is ever fullscreen; the green button zooms.
    fullscreenable: false,
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

// The user closed the window: the setting goes off, saved like any setting
// change, and the main window's settings follow.
function turnSettingOff(): void {
  try {
    updateConfig((draft) => { draft.general.show_preview_window = false })
  } catch (error) {
    log('error', 'The preview window setting could not be turned off', { error: serializeError(error) })
    return
  }
  notifySettingsChanged(getMainWin())
}

function openPreviewWindow(): void {
  const options = buildPreviewWindowOptions(mainTranslator().t('previewWindow.title'))
  const win = createWindowWithUsablePersistedBounds('preview', () => new BrowserWindow({
    ...options,
    backgroundColor: windowBackground(),
  }))
  previewWindow = win
  // A Windows logoff or restart closes every window; that is not the user
  // turning the preview window off.
  let sessionEnding = false
  win.on('session-end', () => { sessionEnding = true })
  win.on('close', () => {
    if (previewWindow === win && !sessionEnding) turnSettingOff()
  })
  win.once('closed', () => {
    dismissSurfaceConfirms('preview-window')
    if (previewWindow === win) previewWindow = null
  })
  hardenWindow(win)
  trackThemedWindow(win)
  configureWindowMinimum(win, () => ({ width: PREVIEW_WINDOW_MIN_WIDTH, height: PREVIEW_WINDOW_MIN_HEIGHT }),
    (error) => log('warn', 'Window minimum could not be updated', { window: 'preview', error: serializeError(error) }))
  win.webContents.on('context-menu', (_event, params) => {
    const template = buildTextContextMenuTemplate(mainTranslator(), params, (word) => win.webContents.replaceMisspelling(word))
    if (template) Menu.buildFromTemplate(template).popup({ window: win })
  })
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive()
  })
  // A lost renderer never leaves a blank window or a confirmation no one can
  // answer: the window goes, its confirmations are answered no, and a window
  // that was showing opens again. A page lost before it loaded would be lost
  // again at once, so that one, like a hidden one, waits for the main window
  // to return.
  let loaded = false
  win.webContents.on('render-process-gone', (_event, details) => {
    if (previewWindow !== win) return
    log('warn', 'Preview window renderer is gone', { reason: details.reason, exitCode: details.exitCode })
    const reopen = loaded && win.isVisible()
    dismissSurfaceConfirms('preview-window')
    destroy(win)
    if (reopen) syncPreviewWindow(loadConfig().general.show_preview_window)
  })
  void loadRendererSurface(win, 'preview-window').then(() => { loaded = true }, (error) => {
    log('error', 'The preview window could not load', { error: serializeError(error) })
    destroy(win)
  })
}

function destroy(win: BrowserWindow): void {
  if (previewWindow === win) previewWindow = null
  if (!win.isDestroyed()) win.destroy()
}

/** Opens or closes the window to match the setting, as Settings saves it. */
export function syncPreviewWindow(enabled: boolean): void {
  if (enabled && !previewWindow) openPreviewWindow()
  else if (!enabled) closePreviewWindow()
}

/** Hides the window with the main window when it goes to the background. */
export function hidePreviewWindow(): void {
  if (previewWindow && !previewWindow.isDestroyed()) {
    dismissSurfaceConfirms('preview-window')
    previewWindow.hide()
  }
}

/** Shows the window again beside the main window, or opens it if the setting
 *  is on and it is not there. */
export function showPreviewWindow(): void {
  if (previewWindow && !previewWindow.isDestroyed()) previewWindow.showInactive()
  else syncPreviewWindow(loadConfig().general.show_preview_window)
}

/** Closes the window without touching the setting: on quit, when the main
 *  window is gone, or when the setting is turned off. */
export function closePreviewWindow(): void {
  const win = previewWindow
  if (win) destroy(win)
}

/** The window's page while it is shown, for routing keys and confirmations. */
export function previewWindowContents(): Electron.WebContents | null {
  const win = previewWindow
  return win && !win.isDestroyed() && win.isVisible() ? win.webContents : null
}

export function initPreviewWindow(getMain: () => BrowserWindow | null): void {
  getMainWin = getMain
  // The window follows every selection, hidden too, so it returns with the
  // current one; a page still loading asks for the latest itself.
  onSelectionPublished((snapshot) => {
    const win = previewWindow
    if (win && !win.isDestroyed()) win.webContents.send(SELECTION_SNAPSHOT_CHANNEL, snapshot)
  })
}
