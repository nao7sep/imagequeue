import { app, BrowserWindow, Menu, nativeTheme } from 'electron'
import path from 'path'
import { loadConfig, ensureDataDir, summarizeConfig } from './config'
import { dropCurrentSessionIfEmpty, drainPendingDraftWrites, initSession, getSessionDir, persistActiveSession, registerSessionIpc, resetOutputTimestampAllocators } from './session'
import { registerQueueIpc } from './queue'
import { startProcessor } from './backends'
import { registerPreviewIpc } from './preview-ipc'
import { registerSettingsIpc } from './settings-ipc'
import { registerElaboratorsIpc } from './elaborators-ipc'
import { registerAppLogIpc } from './app-log-ipc'
import { closeViewerWindow, registerViewerIpc } from './viewer'
import { closeNotificationWindow, initNotificationWindow, registerNotificationIpc } from './notification'
import { initLogger, log, setLoggerDebug, serializeError, shouldEnableDebugLogging } from './logger'
import { updateRecommendationsAtLaunch } from './recommendations'
import { killAllCliJobs } from './cli-jobs'
import { drainPendingWrites as drainPendingModelParamsWrites } from './model-params'
import { applyDevDockIcon } from './dock-icon'
import { startWakeLockMonitor, releaseWakeLock } from './power-blocker'

let mainWin: BrowserWindow | null = null

// Debug is diagnostic-only: enabled automatically for an unpackaged development
// build, and available in packaged builds only through an explicit
// IMAGEQUEUE_DEBUG=1 launch. Set once at process start so every debug line —
// including any logged before the session file is opened — honors the gate.
const DEBUG_ENABLED = shouldEnableDebugLogging({
  isPackaged: app.isPackaged,
  imagequeueDebug: process.env['IMAGEQUEUE_DEBUG'],
})
setLoggerDebug(DEBUG_ENABLED)

// Global last-resort hooks: log with full error fidelity before the process
// dies, and also surface to the console as a backstop for the brief window
// before the session log file is open. An uncaught exception leaves the process
// in an undefined state, so we exit after logging; an unhandled rejection is
// logged but allowed to continue.
process.on('uncaughtException', (err) => {
  log('error', 'Uncaught exception', { error: serializeError(err) })
  console.error('Uncaught exception:', err)
  // app.exit() skips the before-quit graceful shutdown that normally drains the
  // debounced session-draft and model-param writes, so flush them here first —
  // the writers are synchronous and route their own errors to onError, so this
  // best-effort flush cannot itself throw. OS resources (CLI jobs, wake lock)
  // are reclaimed by the OS on exit and need no cleanup on a crash.
  drainPendingModelParamsWrites()
  drainPendingDraftWrites()
  app.exit(1)
})
process.on('unhandledRejection', (reason) => {
  log('error', 'Unhandled rejection', { error: serializeError(reason) })
  console.error('Unhandled rejection:', reason)
})

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1200,
    minHeight: 600,
    backgroundColor: '#1a1a2e',
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
  // The app ships a single dark theme; force dark native chrome (title bar,
  // menus) so it doesn't follow a light OS appearance.
  nativeTheme.themeSource = 'dark'
  ensureDataDir()
  loadConfig()
  initSession()
  resetOutputTimestampAllocators()
  initLogger(getSessionDir())
  log('info', 'App started', {
    version: app.getVersion(),
    packaged: app.isPackaged,
    debug: DEBUG_ENABLED,
    config: summarizeConfig(loadConfig()),
  })

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
      error: serializeError(err)
    })
  })
  startProcessor()
  startWakeLockMonitor()

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
// .catch().finally(app.exit) at the call site so an unexpected throw can't
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
      log('error', 'Shutdown step failed', {
        step: name,
        error: serializeError(err),
      })
    }
  }
  await guarded('drainPendingModelParamsWrites', () => drainPendingModelParamsWrites())
  await guarded('drainPendingDraftWrites', () => drainPendingDraftWrites())
  await guarded('closeViewerWindow', () => closeViewerWindow())
  await guarded('closeNotificationWindow', () => closeNotificationWindow())
  await guarded('killAllCliJobs', () => killAllCliJobs())
  await guarded('releaseWakeLock', () => releaseWakeLock())
  await guarded('dropCurrentSessionIfEmpty', () => dropCurrentSessionIfEmpty(reason))
  log('info', 'Session ended', { reason })
}

// before-quit fires for Cmd+Q, Dock → Quit, the application menu Quit, and
// any programmatic app.quit(). We preventDefault the first invocation, run
// async cleanup, then terminate with app.exit(0).
//
// app.exit(0), not a second app.quit(): on macOS, calling app.quit() after the
// cleanup closes the windows but then stalls — once the last window closes the
// app stays alive instead of proceeding to will-quit/quit, so the dock dot
// lingers and the user has to quit a second time to actually terminate. All
// cleanup is already done by the time the finally runs, so app.exit(0) ends the
// process deterministically. The shutdownStarted guard still lets a second quit
// during cleanup fall through without preventDefault, as a force-quit escape
// hatch in case cleanup ever hangs.
let shutdownStarted = false
app.on('before-quit', (event) => {
  if (shutdownStarted) return
  shutdownStarted = true
  event.preventDefault()
  gracefulShutdown('quit')
    .catch((err) => log('error', 'Graceful shutdown error', {
      error: serializeError(err),
    }))
    .finally(() => app.exit(0))
})
