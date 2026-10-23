import { retainWindowTitle } from './window-title'
import { BrowserWindow, dialog, ipcMain, screen, type IpcMainEvent } from 'electron'
import {
  STARTUP_FAILURE_MEASUREMENT_CHANNEL,
  STARTUP_FAILURE_MESSAGE_CHANNEL,
  fitStartupFailureHeight,
  isStartupFailureMeasurement,
} from '../shared/startup-failure'
import { hardenWindow } from './utils/harden-window'
import { handle } from './ipc-boundary'
import { trackThemedWindow, windowBackground } from './theme'
import { log, serializeError } from './logger'
import { mainTranslator } from './i18n'
import type { Message } from '../shared/i18n/translate'
import { loadRendererSurface, PRELOAD_PATH } from './renderer-surface'

/**
 * Creates ImageQueue's app-authored fatal-startup surface without a native alert
 * icon. It shows only authored copy in the interface language, the message it
 * is given; the diagnostic stays in the log.
 */
export function createStartupFailureWindow(failureMessage: Message): BrowserWindow {
  const win = new BrowserWindow({
    title: mainTranslator().t('startupFailure.title'),
    width: 520,
    height: 1,
    show: false,
    minWidth: 420,
    // Only the fullscreen view is ever fullscreen; the green button zooms.
    fullscreenable: false,
    // The resolved theme's app surface (the OS appearance when config.json
    // could not be read).
    backgroundColor: windowBackground(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  retainWindowTitle(win, () => mainTranslator().t('startupFailure.title'))
  hardenWindow(win)
  trackThemedWindow(win)

  let measurementSettled = false
  let failurePresented = false
  const handleLoadFailure = (error: unknown): void => {
    if (failurePresented || win.isDestroyed()) return
    failurePresented = true
    log('error', 'Failed to load the startup failure surface', { error: serializeError(error) })
    removeMeasurementOwner()
    // The app-owned failure page uses the same renderer that just failed.
    // This last-resort message must work without that runtime or its assets.
    const translator = mainTranslator()
    try {
      dialog.showErrorBox(translator.t('startupFailure.title'), translator.text(failureMessage))
    } finally {
      if (!win.isDestroyed()) win.close()
    }
  }
  const removeMeasurementOwner = (): void => {
    ipcMain.removeListener(STARTUP_FAILURE_MEASUREMENT_CHANNEL, receiveMeasurement)
  }
  const receiveMeasurement = (event: IpcMainEvent, measurement: unknown): void => {
    if (event.sender !== win.webContents || measurementSettled) return
    measurementSettled = true
    removeMeasurementOwner()
    if (!isStartupFailureMeasurement(measurement)) {
      handleLoadFailure(new Error('Startup failure surface reported an invalid measurement'))
      return
    }
    if (win.isDestroyed()) return
    const workAreaHeight = screen.getDisplayMatching(win.getBounds()).workArea.height
    const fit = fitStartupFailureHeight(measurement, workAreaHeight)
    const beforeBounds = win.getBounds()
    win.setMinimumSize(420, fit.minimumHeight)
    win.setContentSize(520, fit.height)
    log('debug', 'Startup failure window fitted', {
      measurement,
      fit,
      beforeBounds,
      afterBounds: win.getBounds(),
    })
    win.show()
  }
  ipcMain.on(STARTUP_FAILURE_MEASUREMENT_CHANNEL, receiveMeasurement)
  win.once('closed', removeMeasurementOwner)

  // Registered once: a process has one startup failure window, and closing it
  // exits the app.
  handle(STARTUP_FAILURE_MESSAGE_CHANNEL, (event) => {
    if (event.sender !== win.webContents) throw new Error('Startup failure message requested by another window')
    return failureMessage
  })

  win.webContents.once('render-process-gone', (_event, details) => {
    handleLoadFailure(new Error(`Startup failure renderer exited: ${details.reason}`))
  })
  void loadRendererSurface(win, 'startup-failure').catch(handleLoadFailure)

  return win
}
