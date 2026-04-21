import { app, BrowserWindow } from 'electron'
import path from 'path'
import { loadConfig, ensureDataDir } from './config'
import { initSession, getSessionDir } from './session'
import { registerQueueIpc } from './queue'
import { queueManager } from './queue/queue-manager'
import { startProcessor } from './backends'
import { registerPreviewIpc } from './preview-ipc'
import { registerSettingsIpc } from './settings-ipc'
import { initLogger, log } from './logger'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  ensureDataDir()
  loadConfig()
  initSession()
  initLogger(getSessionDir())
  registerQueueIpc()
  registerPreviewIpc()
  registerSettingsIpc()
  startProcessor()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  log('info', 'Session ended')
})
