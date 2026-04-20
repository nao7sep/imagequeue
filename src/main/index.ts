import { app, BrowserWindow, dialog } from 'electron'
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

// Confirm close if tasks are pending or generating
app.on('before-quit', (event) => {
  const allTasks = queueManager.getAllTasks()
  const hasPending = Object.values(allTasks).some((tasks) =>
    tasks.some((t) => t.status === 'queued' || t.status === 'generating')
  )

  if (hasPending) {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return

    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Quit Anyway', 'Cancel'],
      defaultId: 1,
      title: 'Tasks in Progress',
      message: 'Some tasks are still queued or generating. Quit anyway?'
    })

    if (choice === 1) {
      event.preventDefault()
    } else {
      const activeTasks = Object.entries(allTasks).flatMap(([backend, tasks]) =>
        tasks
          .filter((t) => t.status === 'queued' || t.status === 'generating')
          .map((t) => ({ id: t.id, backend, status: t.status }))
      )
      log('warn', 'Quitting with active tasks', { count: activeTasks.length, tasks: activeTasks })
    }
  }
})
