import { app, BrowserWindow, dialog, Menu, nativeTheme } from 'electron'
import path from 'path'
import { loadConfig, ensureDataDir, getDataDir, getLogsDir, summarizeConfig } from './config'
import { dropCurrentSessionIfEmpty, drainPendingDraftWrites, initSession, getSessionDir, persistActiveSession, registerSessionIpc, resetOutputTimestampAllocators } from './session'
import { registerQueueIpc } from './queue'
import { startProcessor, stopProcessor } from './backends'
import { registerPreviewIpc } from './preview-ipc'
import { registerSettingsIpc } from './settings-ipc'
import { registerStateIpc } from './state-ipc'
import { registerDependenciesIpc } from './dependencies-ipc'
import { checkDependenciesAtLaunch } from './dependencies/service'
import { clearTempDir } from './dependencies/paths'
import { registerElaboratorsIpc } from './elaborators-ipc'
import { registerConceptsIpc } from './concepts-ipc'
import { materializeElaborators } from './elaborators'
import { registerAppLogIpc } from './app-log-ipc'
import { closeViewerWindow, registerViewerIpc } from './viewer'
import { closeNotificationWindow, initNotificationWindow, registerNotificationIpc } from './notification'
import { initLogger, log, setLoggerDebug, serializeError, shouldEnableDebugLogging } from './logger'
import { killAllCliJobsAndWait } from './cli-jobs'
import { cancelAllInFlightAndWait } from './backends/cancellation'
import { drainPendingWrites as drainPendingModelParamsWrites } from './model-params'
import { startWakeLockMonitor, releaseWakeLock } from './power-blocker'
import { hardenWindow } from './utils/harden-window'
import { queueManager } from './queue/queue-manager'
import { installContentSecurityPolicy } from './csp'
import { buildMainWindowOptions } from './window-options'
import {
  getVisiblePaneCount,
  registerMainWindowForLayout,
  unregisterMainWindowForLayout,
} from './main-window-layout'
import { startupFailureMessage } from './startup-error'
import { MainWindowController } from './main-window-lifecycle'
import { StatusIconController } from './status-icon'
import { openOutputFolder } from './session/open-output-folder'
import { setQueuePausedAndPublish } from './queue/control-actions'
import { installStatusIconAcceptanceFixture } from './status-icon-acceptance'

let mainWindowController: MainWindowController<BrowserWindow> | null = null
let statusIconController: StatusIconController | null = null

// Every mutable app store is process-owned. Letting a second ImageQueue process
// open the same root would turn otherwise-atomic file replacement into competing
// read/modify/write snapshots (most dangerously for api-keys.json). Electron's
// native instance authority closes that entire class of split-brain state; a
// second launch raises the existing window instead of starting another writer.
const ownsSingleInstance = app.requestSingleInstanceLock()
if (!ownsSingleInstance) app.quit()

app.on('second-instance', () => {
  void mainWindowController?.restoreOrCreate()
})

// Electron's default is to quit after the last BrowserWindow closes when no
// listener exists. Primary-window close policy belongs to MainWindowController;
// explicit quit paths continue through the before-quit handler below.
app.on('window-all-closed', () => {})

// Debug is diagnostic-only: enabled automatically for an unpackaged development
// build, and available in packaged builds only through an explicit
// IMAGEQUEUE_DEBUG=1 launch. Set once at process start so every debug line —
// including any logged before the launch log is opened — honors the gate.
const DEBUG_ENABLED = shouldEnableDebugLogging({
  isPackaged: app.isPackaged,
  imagequeueDebug: process.env['IMAGEQUEUE_DEBUG'],
})
setLoggerDebug(DEBUG_ENABLED)

// Global last-resort hooks: log with full error fidelity before the process
// dies, and also surface to the console as a backstop for the brief window
// before the launch log is open. An uncaught exception leaves the process
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

function createWindow(): BrowserWindow {
  // Chrome + sizing come from the pure buildMainWindowOptions: the window
  // minimum and opening width are DERIVED from the shared pane minimums and the
  // pane count (see shared/layout-metrics), never a magic literal, so the window
  // can't be shrunk small enough to truncate a pane and doesn't open wider than
  // its panes need. themeSource is applied to nativeTheme in app.whenReady()
  // from the same source.
  const { themeSource: _themeSource, ...windowOptions } = buildMainWindowOptions(getVisiblePaneCount())
  const win = new BrowserWindow({
    ...windowOptions,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  registerMainWindowForLayout(win)
  hardenWindow(win)

  win.on('closed', () => {
    unregisterMainWindowForLayout(win)
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
  return win
}

if (ownsSingleInstance) app.whenReady().then(() => {
  // The startup body throws on a corrupt config.json (loadConfig deliberately
  // does not fall back to defaults — see config-store.ts). Without this catch
  // the rejection lands in the unhandledRejection hook, which logs and does NOT
  // exit — a running process with no window and no dialog is not a halt
  // (storage-path conventions: a halt names the store and reaches the user).
  try {
    startUp()
  } catch (err) {
    dialog.showErrorBox(
      'ImageQueue could not start',
      startupFailureMessage(err),
    )
    app.exit(1)
  }
})

function startUp(): void {
  // The app ships a single dark theme; force dark native chrome (title bar,
  // menus) so it doesn't follow a light OS appearance. The value comes from the
  // same window-options source createWindow uses, so chrome theme and window
  // sizing stay defined in one place.
  nativeTheme.themeSource = buildMainWindowOptions(getVisiblePaneCount()).themeSource
  // Set the renderer CSP before any window loads its content. Gate the strict
  // policy on the production-renderer signal (no dev-server URL), not
  // app.isPackaged — so run-built/rebuild (electron-vite preview, which runs
  // unpackaged) still exercise the strict production CSP.
  installContentSecurityPolicy(!process.env['ELECTRON_RENDERER_URL'])
  ensureDataDir()
  // Open this launch's log immediately after the storage root exists and before
  // any other startup step, so a failure in one of them is logged rather than
  // lost to the console. Everything below this line has a log to write to.
  initLogger(getLogsDir())
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
  const statusIconAcceptance = installStatusIconAcceptanceFixture(getDataDir())
  log('info', 'App started', {
    version: app.getVersion(),
    packaged: app.isPackaged,
    debug: DEBUG_ENABLED,
    config: summarizeConfig(loadConfig()),
  })
  // Every launch opens a fresh session, and the log has to say which one: it is
  // where this launch's images land, and the log no longer lives inside it.
  // Switching or resuming a session logs its own line from session/state.
  log('info', 'Session started', { sessionDir: getSessionDir() })

  persistActiveSession()
  mainWindowController = new MainWindowController({
    platform: process.platform,
    createWindow,
    isStatusIconAvailable: () => statusIconController?.isAvailable() ?? false,
    closeViewerWindow,
    onPrimaryWindowClosed: () => {
      if (process.platform !== 'darwin') app.quit()
    },
    dock: app.dock,
  })
  statusIconController = new StatusIconController({
    restoreMainWindow: () => mainWindowController?.restoreOrCreate(),
    requestQuit: () => app.quit(),
    openOutputFolder,
    setQueuePaused: setQueuePausedAndPublish,
  })
  registerSessionIpc()
  registerQueueIpc()
  registerPreviewIpc()
  registerSettingsIpc(async (config) => {
    await statusIconController?.reconcile(config.general.show_status_icon)
  })
  registerStateIpc()
  registerDependenciesIpc()
  registerElaboratorsIpc()
  registerConceptsIpc()
  registerAppLogIpc()
  registerViewerIpc(() => mainWindowController?.getWindow() ?? null)
  registerNotificationIpc()
  initNotificationWindow()
  if (!statusIconAcceptance) startProcessor()
  startWakeLockMonitor()

  // Re-check the managed dependencies if the launch toggle is on and the last
  // check is past the staleness cap. Fire-and-forget: never blocks startup, and
  // its result is surfaced passively (pane pointer / modal), never as a prompt.
  void checkDependenciesAtLaunch()

  // The just-in-case data backup is no longer a startup pass (data-backup
  // conventions). It is write-through: every managed-text save records the bytes
  // it just wrote into ~/.imagequeue/backups.sqlite3 strictly after its atomic
  // rename lands (see utils/atomic-write.ts → backup/backup-store.ts). There is
  // nothing to run here — the history is always as current as the last save.

  void statusIconController.reconcile(loadConfig().general.show_status_icon)
  mainWindowController.createInitialWindow()
  mainWindowController.markStartupComplete()

  app.on('activate', () => {
    void mainWindowController?.restoreOrCreate()
  })
}

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
  // Freeze scheduling before touching active work. Otherwise the 500ms poller
  // can promote another queued task between the cancellation snapshot and exit.
  await guarded('stopProcessor', () => stopProcessor())
  await guarded('drainPendingModelParamsWrites', () => drainPendingModelParamsWrites())
  await guarded('drainPendingDraftWrites', () => drainPendingDraftWrites())

  // Signal both external-work families before awaiting either one. Each barrier
  // is bounded and includes its TERM→KILL escalation, so quit cannot strand a
  // child but also cannot hang forever on a broken process implementation.
  const generationBarrier = cancelAllInFlightAndWait(5_000)
  const cliBarrier = killAllCliJobsAndWait({ timeoutMs: 5_000 })
  await guarded('cancelInFlightGenerations', async () => {
    const result = await generationBarrier
    if (!result.settled) log('warn', 'Generation shutdown barrier timed out', result)
  })
  await guarded('killAllCliJobs', async () => {
    const result = await cliBarrier
    if (!result.settled) log('warn', 'CLI job shutdown barrier timed out', result)
  })

  // Cancellation normally updates each task itself. This catches any residual
  // task whose backend failed to settle before the bounded deadline.
  await guarded('interruptGeneratingTasks', () => {
    const count = queueManager.interruptGeneratingTasks()
    if (count > 0) {
      persistActiveSession()
      log('info', 'Marked in-flight tasks interrupted on shutdown', { count })
    }
  })
  await guarded('closeViewerWindow', () => closeViewerWindow())
  await guarded('closeNotificationWindow', () => closeNotificationWindow())
  await guarded('releaseWakeLock', () => releaseWakeLock())
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
// generation and CLI child is signalled and awaited through a bounded barrier.)
// A cloud call already issued may still be billed. The shutdownStarted
// guard still lets a second quit during cleanup fall through without
// preventDefault, as a force-quit escape hatch in case cleanup ever hangs.
app.on('before-quit', (event) => {
  if (mainWindowController && !mainWindowController.beginShutdown()) return
  event.preventDefault()
  statusIconController?.dispose()
  mainWindowController?.dispose()
  gracefulShutdown('quit')
    .catch((err) => log('error', 'Graceful shutdown error', {
      error: serializeError(err),
    }))
    .finally(() => app.exit(0))
})
