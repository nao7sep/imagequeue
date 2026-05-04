import { app, BrowserWindow, Menu } from 'electron'
import path from 'path'
import { loadConfig, ensureDataDir } from './config'
import { initSession, getSessionDir, persistActiveSession, registerSessionIpc } from './session'
import { registerQueueIpc } from './queue'
import { startProcessor } from './backends'
import { registerPreviewIpc } from './preview-ipc'
import { registerSettingsIpc } from './settings-ipc'
import { closeViewerWindow, registerViewerIpc } from './viewer'
import { closeNotificationWindow, initNotificationWindow, registerNotificationIpc } from './notification'
import { initLogger, log } from './logger'
import { updateRecommendationsAtLaunch } from './recommendations'
import { killAllCliJobs } from './cli-jobs'

let mainWin: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1200,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWin = win

  win.on('closed', () => {
    if (mainWin === win) mainWin = null
    closeViewerWindow()
    if (process.platform !== 'darwin') app.quit()
  })

  win.webContents.on('context-menu', (_event, params) => {
    const { isEditable, selectionText, editFlags, misspelledWord, dictionarySuggestions } = params
    const hasSelection = selectionText.length > 0

    if (!isEditable && !hasSelection) return

    const template: Electron.MenuItemConstructorOptions[] = []

    if (misspelledWord) {
      if (dictionarySuggestions.length > 0) {
        for (const word of dictionarySuggestions) {
          template.push({ label: word, click: () => win.webContents.replaceMisspelling(word) })
        }
      } else {
        template.push({ label: 'No suggestions', enabled: false })
      }
      template.push({ type: 'separator' })
    }

    if (isEditable) {
      if (editFlags.canUndo || editFlags.canRedo) {
        template.push(
          { label: 'Undo', role: 'undo', enabled: editFlags.canUndo },
          { label: 'Redo', role: 'redo', enabled: editFlags.canRedo },
          { type: 'separator' }
        )
      }
      template.push(
        { label: 'Cut', role: 'cut', enabled: editFlags.canCut },
        { label: 'Copy', role: 'copy', enabled: editFlags.canCopy },
        { label: 'Paste', role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' },
        { label: 'Select All', role: 'selectAll', enabled: editFlags.canSelectAll }
      )
    } else if (hasSelection) {
      template.push({ label: 'Copy', role: 'copy' })
    }

    Menu.buildFromTemplate(template).popup({ window: win })
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
  persistActiveSession()
  registerSessionIpc()
  registerQueueIpc()
  registerPreviewIpc()
  registerSettingsIpc()
  registerViewerIpc()
  registerNotificationIpc(() => mainWin)
  initNotificationWindow()
  void updateRecommendationsAtLaunch().catch((err) => {
    log('warn', 'Recommendations launch update rejected unexpectedly', {
      message: (err as Error).message
    })
  })
  startProcessor()

  createWindow()

  app.on('activate', () => {
    if (!mainWin || mainWin.isDestroyed()) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Destroy auxiliary windows in before-quit, before Electron sends close events
// to any window. The viewer's close handler calls event.preventDefault() to
// convert OS-close into a hide; if that fired during quit, will-quit would
// never be reached and the app would get stuck.
app.on('before-quit', () => {
  closeViewerWindow()
  closeNotificationWindow()
  killAllCliJobs()
})

app.on('will-quit', () => {
  log('info', 'Session ended')
})
