import { app, BrowserWindow, Menu } from 'electron'
import path from 'path'
import icon from '../../resources/icon.png?asset'
import { loadConfig, ensureDataDir } from './config'
import { dropCurrentSessionIfEmpty, initSession, getSessionDir, persistActiveSession, registerSessionIpc, resetOutputTimestampAllocators } from './session'
import { registerQueueIpc } from './queue'
import { startProcessor } from './backends'
import { registerPreviewIpc } from './preview-ipc'
import { registerSettingsIpc } from './settings-ipc'
import { registerElaboratorsIpc } from './elaborators-ipc'
import { registerAppLogIpc } from './app-log-ipc'
import { closeViewerWindow, registerViewerIpc } from './viewer'
import { closeNotificationWindow, initNotificationWindow, registerNotificationIpc } from './notification'
import { initLogger, log } from './logger'
import { updateRecommendationsAtLaunch } from './recommendations'
import { killAllCliJobs } from './cli-jobs'
import { drainPendingWrites as drainPendingModelParamsWrites } from './model-params'

let mainWin: BrowserWindow | null = null

// In dev the app runs under the prebuilt Electron.app binary, whose bundle
// carries Electron's default Dock icon. app.dock.setIcon only draws a temporary
// overlay on the in-memory Dock tile — it does not change the bundle on disk, so
// macOS discards it whenever it rebuilds the tile (notably when a window is
// (re)created via the activate handler). We therefore re-assert the icon after
// each window creation rather than once at startup. Purely cosmetic and dev-only:
// the packaged build gets its icon from build/icon.icns (and resources/ isn't
// shipped). setIcon throws if the image path is missing/unreadable, so it is
// wrapped — a decorative icon must never stop the app from starting. macOS only;
// app.dock is undefined elsewhere.
function applyDevDockIcon(): void {
  if (process.platform !== 'darwin' || app.isPackaged) return
  try {
    app.dock?.setIcon(icon)
  } catch (err) {
    log('warn', 'Failed to set dev Dock icon', {
      message: err instanceof Error ? err.message : String(err)
    })
  }
}

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
  resetOutputTimestampAllocators()
  initLogger(getSessionDir())

  persistActiveSession()
  registerSessionIpc()
  registerQueueIpc()
  registerPreviewIpc()
  registerSettingsIpc()
  registerElaboratorsIpc()
  registerAppLogIpc()
  registerViewerIpc(() => mainWin)
  registerNotificationIpc(() => mainWin)
  initNotificationWindow()
  void updateRecommendationsAtLaunch().catch((err) => {
    log('warn', 'Recommendations launch update rejected unexpectedly', {
      message: (err as Error).message
    })
  })
  startProcessor()

  createWindow()
  applyDevDockIcon()

  app.on('activate', () => {
    if (!mainWin || mainWin.isDestroyed()) {
      createWindow()
    }
    applyDevDockIcon()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Async cleanup run from before-quit. Each step is independently guarded so
// one failing step doesn't skip the rest, and the whole thing is wrapped in
// .catch().finally(app.quit()) at the call site so an unexpected throw can't
// strand the process or escape as an unhandled rejection.
//
// We close the viewer and notification windows here, before Electron starts
// sending close events to the main window. The viewer's own close handler
// calls event.preventDefault() to convert OS-close into a hide; if that fired
// during quit, the app would get stuck.
async function gracefulShutdown(reason: string): Promise<void> {
  const guarded = async (name: string, fn: () => unknown): Promise<void> => {
    try {
      await fn()
    } catch (err) {
      log('error', `Shutdown step failed: ${name}`, {
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  await guarded('drainPendingModelParamsWrites', () => drainPendingModelParamsWrites())
  await guarded('closeViewerWindow', () => closeViewerWindow())
  await guarded('closeNotificationWindow', () => closeNotificationWindow())
  await guarded('killAllCliJobs', () => killAllCliJobs())
  await guarded('dropCurrentSessionIfEmpty', () => dropCurrentSessionIfEmpty(reason))
  log('info', 'Session ended', { reason })
}

// before-quit fires for Cmd+Q, Dock → Quit, the application menu Quit, and
// any programmatic app.quit(). We preventDefault the first invocation, run
// async cleanup, then call app.quit() again — the re-entry guard short-circuits
// without preventDefault, so Electron's default flow proceeds (windows close,
// will-quit fires, process exits).
let shutdownStarted = false
app.on('before-quit', (event) => {
  if (shutdownStarted) return
  shutdownStarted = true
  event.preventDefault()
  gracefulShutdown('quit')
    .catch((err) => log('error', 'Graceful shutdown error', {
      message: err instanceof Error ? err.message : String(err),
    }))
    .finally(() => app.quit())
})
