import { BrowserWindow, screen } from 'electron'
import path from 'path'
import { STARTUP_FAILURE_TITLE, fitStartupFailureHeight, type StartupFailureMeasurement } from '../shared/startup-failure'
import { hardenWindow } from './utils/harden-window'
import { log, serializeError } from './logger'

/** Creates ImageQueue's app-authored fatal-startup surface without a native alert icon. */
export function createStartupFailureWindow(message: string): BrowserWindow {
  const win = new BrowserWindow({
    title: STARTUP_FAILURE_TITLE,
    width: 520,
    height: 1,
    show: false,
    minWidth: 420,
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

  win.webContents.once('dom-ready', () => {
    void win.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('.startup-failure-app');
      const title = root?.querySelector('h1');
      const body = root?.querySelector('p');
      const footer = root?.querySelector('footer');
      if (!root || !title || !body || !footer) throw new Error('startup failure surface is incomplete');
      root.dataset.measuring = 'true';
      const bodyStyle = getComputedStyle(body);
      const lineHeight = Number.parseFloat(bodyStyle.lineHeight) || 24;
      const bodyPadding = Number.parseFloat(bodyStyle.paddingTop) + Number.parseFloat(bodyStyle.paddingBottom);
      const naturalHeight = title.offsetHeight + body.scrollHeight + footer.offsetHeight;
      const minimumHeight = title.offsetHeight + Math.ceil(lineHeight + bodyPadding) + footer.offsetHeight;
      delete root.dataset.measuring;
      return { naturalHeight, minimumHeight };
    })()`)
      .then((measurement: StartupFailureMeasurement) => {
        if (win.isDestroyed()) return
        const workAreaHeight = screen.getDisplayMatching(win.getBounds()).workArea.height
        const fit = fitStartupFailureHeight(measurement, workAreaHeight)
        win.setMinimumSize(420, fit.minimumHeight)
        win.setContentSize(520, fit.height)
        win.show()
      })
      .catch((error: unknown) => {
        console.error('Failed to measure the startup failure surface', error)
        if (win.isDestroyed()) return
        const workAreaHeight = screen.getDisplayMatching(win.getBounds()).workArea.height
        win.setContentSize(520, Math.max(1, Math.floor(workAreaHeight * 0.85)))
        win.show()
      })
  })

  const handleLoadFailure = (error: unknown): void => {
    log('error', 'Failed to load the startup failure surface', { error: serializeError(error) })
    if (!win.isDestroyed()) win.close()
  }

  if (process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    url.searchParams.set('surface', 'startup-failure')
    url.searchParams.set('message', message)
    void win.loadURL(url.toString()).catch(handleLoadFailure)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { surface: 'startup-failure', message },
    }).catch(handleLoadFailure)
  }

  return win
}
