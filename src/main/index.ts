import { app, BrowserWindow, Menu, nativeTheme } from 'electron'
import path from 'path'
import { loadConfig, ensureDataDir, summarizeConfig } from './config'
import { dropCurrentSessionIfEmpty, drainPendingDraftWrites, initSession, getSessionDir, persistActiveSession, registerSessionIpc, resetOutputTimestampAllocators } from './session'
import { registerQueueIpc } from './queue'
import { startProcessor } from './backends'
import { registerPreviewIpc } from './preview-ipc'
import { registerSettingsIpc } from './settings-ipc'
import { registerDependenciesIpc } from './dependencies-ipc'
import { checkDependenciesAtLaunch } from './dependencies/service'
import { clearTempDir } from './dependencies/paths'
import { registerElaboratorsIpc } from './elaborators-ipc'
import { materializeElaborators } from './elaborators'
import { registerAppLogIpc } from './app-log-ipc'
import { closeViewerWindow, registerViewerIpc } from './viewer'
import { closeNotificationWindow, initNotificationWindow, registerNotificationIpc } from './notification'
import { initLogger, log, setLoggerDebug, serializeError, shouldEnableDebugLogging } from './logger'
import { killAllCliJobs } from './cli-jobs'
import { drainPendingWrites as drainPendingModelParamsWrites } from './model-params'
import { startWakeLockMonitor, releaseWakeLock } from './power-blocker'
import { hardenWindow } from './utils/harden-window'
import { queueManager } from './queue/queue-manager'
import { installContentSecurityPolicy } from './csp'
import { buildMainWindowOptions } from './window-options'
import { runBackupInBackground } from './backup/backup-service'

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
  // Chrome + sizing come from the pure buildMainWindowOptions: the window
  // minimum is DERIVED from the shared pane minimums plus the platform-dependent
  // visible-column count (see shared/layout-metrics), never a magic literal, so
  // the window can't be shrunk small enough to truncate a pane. themeSource is
  // applied to nativeTheme in app.whenReady() from the same source.
  const { themeSource: _themeSource, ...windowOptions } = buildMainWindowOptions(process.platform)
  const win = new BrowserWindow({
    ...windowOptions,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWin = win
  hardenWindow(win)

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
  // menus) so it doesn't follow a light OS appearance. The value comes from the
  // same window-options source createWindow uses, so chrome theme and window
  // sizing stay defined in one place.
  nativeTheme.themeSource = buildMainWindowOptions(process.platform).themeSource
  // Set the renderer CSP before any window loads its content. Gate the strict
  // policy on the production-renderer signal (no dev-server URL), not
  // app.isPackaged — so run-built/rebuild (electron-vite preview, which runs
  // unpackaged) still exercise the strict production CSP.
  installContentSecurityPolicy(!process.env['ELECTRON_RENDERER_URL'])
  ensureDataDir()
  clearTempDir()
  loadConfig()
  // Materialize the shipped elaborators the same way loadConfig materializes
  // config.json: write elaborators.json from the in-code defaults on first run,
  // only when absent, at this populated-but-not-yet-used point before any
  // consumer (the renderer's elaborators:list, the backup pass) reads it. A
  // launch-then-quit then leaves a real, editable elaborators.json on disk and
  // in the first-run backup, instead of a phantom that materialized only when
  // the renderer first asked for the list. (storage-path conventions)
  materializeElaborators()
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
  registerDependenciesIpc()
  registerElaboratorsIpc()
  registerAppLogIpc()
  registerViewerIpc(() => mainWin)
  registerNotificationIpc(() => mainWin)
  initNotificationWindow()
  startProcessor()
  startWakeLockMonitor()

  // Re-check the managed dependencies if the launch toggle is on and the last
  // check is past the staleness cap. Fire-and-forget: never blocks startup, and
  // its result is surfaced passively (pane pointer / modal), never as a prompt.
  void checkDependenciesAtLaunch()

  // Just-in-case data backup (data-backup conventions): a best-effort, silent,
  // incremental snapshot of the home root taken at startup. Fire-and-forget —
  // it never blocks the window, shows an error, or crashes the app; the pass
  // logs its own outcome. Config has been materialized above (loadConfig
  // writes config.json on first run), so the backup sees a complete home root.
  runBackupInBackground()

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
  // Any task still 'generating' is being abandoned by this quit (an in-flight
  // cloud call cannot be reclaimed). Record it as 'interrupted' and persist, so
  // the manifest is honest at rest and resume offers to re-queue it, rather than
  // leaving a task frozen as 'generating'.
  await guarded('interruptGeneratingTasks', () => {
    const count = queueManager.interruptGeneratingTasks()
    if (count > 0) {
      persistActiveSession()
      log('info', 'Marked in-flight tasks interrupted on shutdown', { count })
    }
  })
  await guarded('closeViewerWindow', () => closeViewerWindow())
  await guarded('closeNotificationWindow', () => closeNotificationWindow())
  await guarded('killAllCliJobs', () => killAllCliJobs())
  await guarded('releaseWakeLock', () => releaseWakeLock())
  // Write the "Session ended" line BEFORE dropping the session, not after. The
  // logger appends to the active session's session.log inside the session dir;
  // dropCurrentSessionIfEmpty trashes that whole directory for an empty session,
  // so logging afterward would fail with ENOENT and spill the line to stderr on
  // every clean quit of an empty session. Ordered this way, a kept session gets
  // the line in-file, and a dropped session writes-then-discards it with the
  // directory — no failed append either way. This is the last shutdown line;
  // every earlier step logs only on failure (guarded's catch) and runs before
  // the drop, so none shares this hazard.
  log('info', 'Session ended', { reason })
  await guarded('dropCurrentSessionIfEmpty', () => dropCurrentSessionIfEmpty(reason))
}

// before-quit fires for Cmd+Q, Dock → Quit, the application menu Quit, and
// any programmatic app.quit(). We preventDefault the first invocation, run
// async cleanup, then terminate with app.exit(0).
//
// app.exit(0), not a second app.quit(): on macOS, calling app.quit() after the
// cleanup closes the windows but then stalls — once the last window closes the
// app stays alive instead of proceeding to will-quit/quit, so the dock dot
// lingers and the user has to quit a second time to actually terminate. The
// gracefulShutdown steps above have all run by the time the finally fires, so
// app.exit(0) ends the process deterministically. (Note: an in-flight image
// generation is not awaited — it is abandoned and recorded as 'interrupted' for
// resume; a cloud call already issued cannot be reclaimed.) The shutdownStarted
// guard still lets a second quit during cleanup fall through without
// preventDefault, as a force-quit escape hatch in case cleanup ever hangs.
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
