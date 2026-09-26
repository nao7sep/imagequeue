import { BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron'
import path from 'path'
import {
  STARTUP_FAILURE_MEASUREMENT_CHANNEL,
  fitStartupFailureHeight,
  isStartupFailureMeasurement,
} from '../shared/startup-failure'
import { hardenWindow } from './utils/harden-window'
import { trackThemedWindow, windowBackground } from './theme'
import { log, serializeError } from './logger'
import { mainTranslator } from './i18n'

/**
 * Creates ImageQueue's app-authored fatal-startup surface without a native alert
 * icon. It shows only authored copy in the interface language; the diagnostic
 * stays in the log.
 */
export function createStartupFailureWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: mainTranslator().t('startupFailure.title'),
    width: 520,
    height: 1,
    show: false,
    minWidth: 420,
    // The resolved theme's app surface (the OS appearance when config.json
    // could not be read).
    backgroundColor: windowBackground(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  hardenWindow(win)
  trackThemedWindow(win)

  let measurementSettled = false
  const removeMeasurementOwner = (): void => {
    ipcMain.removeListener(STARTUP_FAILURE_MEASUREMENT_CHANNEL, receiveMeasurement)
  }
  const receiveMeasurement = (event: IpcMainEvent, measurement: unknown): void => {
    if (event.sender !== win.webContents || measurementSettled) return
    measurementSettled = true
    removeMeasurementOwner()
    if (!isStartupFailureMeasurement(measurement)) {
      log('error', 'Startup failure surface reported an invalid measurement')
      if (!win.isDestroyed()) win.close()
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

  const handleLoadFailure = (error: unknown): void => {
    log('error', 'Failed to load the startup failure surface', { error: serializeError(error) })
    if (!win.isDestroyed()) win.close()
  }

  if (process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    url.searchParams.set('surface', 'startup-failure')
    void win.loadURL(url.toString()).catch(handleLoadFailure)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { surface: 'startup-failure' },
    }).catch(handleLoadFailure)
  }

  return win
}
