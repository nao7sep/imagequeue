import { app, BrowserWindow, Menu } from 'electron'
import path from 'path'
import { loadConfig, ensureDataDir, getDataDir, summarizeConfig } from './config'
import { dropCurrentSessionIfEmpty, drainPendingDraftWrites, initSession, getSessionDir, persistActiveSession, registerSessionIpc, resetOutputTimestampAllocators } from './session'
import { registerQueueIpc } from './queue'
import { startProcessor, stopProcessor } from './backends'
import { registerImageProtocol, registerImageSchemeAsPrivileged } from './image-protocol'
import { registerSettingsIpc } from './settings-ipc'
import { registerStateIpc } from './state-ipc'
import { registerDependenciesIpc } from './dependencies-ipc'
import { checkDependenciesAtLaunch } from './dependencies/service'
import { clearTempDir } from './dependencies/paths'
import { registerElaboratorsIpc } from './elaborators-ipc'
import { closeConceptStore } from './concepts/concept-store'
import { closeBackupStore } from './backup/backup-store'
import { archiveSession } from './backup/archive'
import { registerConceptsIpc } from './concepts-ipc'
import { registerAppLogIpc } from './app-log-ipc'
import { registerAppNoticeIpc } from './app-notice-ipc'
import { closeFullscreenView, destroyFullscreenView } from './fullscreen-view'
import { registerViewingIpc } from './viewing-ipc'
import { closePreviewWindow, hidePreviewWindow, showPreviewWindow, syncPreviewWindow } from './preview-window'
import { closeNotificationWindow, initNotificationWindow, registerNotificationIpc } from './notification'
import { log, setLoggerDebug, serializeError, shouldEnableDebugLogging } from './logger'
import { onRecordStored, openRecords } from './records'
import { registerRecordsIpc } from './records-ipc'
import { closeRecordsReader } from './records-reader'
import { closeRecordsWindow, notifyRecordsChanged } from './records-window'
import { killAllCliJobsAndWait } from './cli-jobs'
import { cancelAllInFlightAndWait } from './backends/cancellation'
import { drainPendingWrites as drainPendingModelParamsWrites } from './model-params'
import { startWakeLockMonitor, releaseWakeLock } from './power-blocker'
import { hardenWindow } from './utils/harden-window'
import { queueManager } from './queue/queue-manager'
import { installContentSecurityPolicy } from './csp'
import { buildMainWindowOptions } from './window-options'
import { applyThemePreference, followOsThemeChanges, trackThemedWindow, windowBackground } from './theme'
import { createWindowWithUsablePersistedBounds } from './window-state-recovery'
import {
  getVisiblePaneCount,
  registerMainWindowForLayout,
  unregisterMainWindowForLayout,
} from './main-window-layout'
import { createStartupFailureWindow } from './startup-failure-window'
import { createBeforeQuitHandler } from './quit-handler'
import { startupFailurePresentation } from './failure-presentation'
import { MainWindowController } from './main-window-lifecycle'
import { StatusIconController } from './status-icon'
import { openOutputFolder } from './session/open-output-folder'
import { setQueuePausedAndPublish } from './queue/control-actions'
import { ownMainWindowContentLoad } from './main-window-content'
import { applyLanguagePreference, mainTranslator, onLanguageChanged, registerLanguageIpc, settleLanguage } from './i18n'
import { buildAppMenuTemplate, buildTextContextMenuTemplate } from './app-menu'

let mainWindowController: MainWindowController<BrowserWindow> | null = null
let statusIconController: StatusIconController | null = null
let startupFailureWindow: BrowserWindow | null = null

function enterStartupFailure(error: unknown, failedWindow?: BrowserWindow): void {
  log('error', 'ImageQueue startup failed', { error: serializeError(error) })
  if (startupFailureWindow && !startupFailureWindow.isDestroyed()) {
    if (failedWindow && !failedWindow.isDestroyed()) failedWindow.destroy()
    return
  }
  // The window shows authored copy only; the diagnostic stays in the log.
  startupFailureWindow = createStartupFailureWindow(startupFailurePresentation(error))
  // Create the recovery owner before destroying the failed primary window so
  // its closed callback cannot turn this fatal path into an ordinary quit.
  if (failedWindow && !failedWindow.isDestroyed()) failedWindow.destroy()
  startupFailureWindow.on('closed', () => {
    startupFailureWindow = null
    app.exit(1)
  })
}

// Debug is diagnostic-only: enabled automatically for an unpackaged development
// build, and available in packaged builds only through an explicit
// IMAGEQUEUE_DEBUG=1 launch. Set once at process start so every debug line —
// including any logged before the records are opened — honors the gate.
const DEBUG_ENABLED = shouldEnableDebugLogging({
  isPackaged: app.isPackaged,
  imagequeueDebug: process.env['IMAGEQUEUE_DEBUG'],
})

// before-quit fires for Cmd+Q, Dock → Quit, the application menu Quit, and
// any programmatic app.quit(). Every quit is held; the first runs the async
// cleanup and the process ends with app.exit(0) once it settles, so a second
// quit during cleanup cannot end the process before cleanup finishes.
//
// app.exit(0), not a second app.quit(): on macOS, calling app.quit() after the
// cleanup closes the windows but then stalls — once the last window closes the
// app stays alive instead of proceeding to will-quit/quit, so the dock dot
// lingers and the user has to quit a second time to actually terminate. (Note:
// an in-flight image generation and CLI child is signalled and awaited through
// a bounded barrier.) A cloud call already issued may still be billed. The
// whole cleanup is bounded above its own steps' bounds, so a step that hangs
// still ends in an exit.
const QUIT_TIMEOUT_MS = 30_000

// The primary instance: everything ImageQueue does once index.ts holds the
// single-instance lock.
export function runPrimaryInstance(): void {
  app.on('second-instance', () => {
    void mainWindowController?.restoreOrCreate()
  })

  // Electron's default is to quit after the last BrowserWindow closes when no
  // listener exists. Primary-window close policy belongs to MainWindowController;
  // explicit quit paths continue through the before-quit handler below.
  app.on('window-all-closed', () => {})

  setLoggerDebug(DEBUG_ENABLED)
  installLastResortHooks()

  // Scheme privileges can only be granted before the app is ready.
  registerImageSchemeAsPrivileged()

  app.whenReady().then(async () => {
    try {
    // The language is settled before any window or native menu exists, so the
    // first words on every surface, a startup failure included, are already in it.
    await settleLanguage()
    registerLanguageIpc()
    installAppMenu()
    // The startup body throws when a store cannot be recovered, such as a
    // config.json that cannot be read or set aside (config-store.ts). Without this catch
    // the rejection lands in the unhandledRejection hook, which logs and does NOT
    // exit — a running process with no window and no dialog is not a halt
    // (storage-path conventions: a halt names the store and reaches the user).
      await startUp()
    } catch (err) {
      enterStartupFailure(err)
    }
  })

  app.on('before-quit', createBeforeQuitHandler({
    shutdown: async () => {
      mainWindowController?.beginShutdown()
      statusIconController?.dispose()
      mainWindowController?.dispose()
      await gracefulShutdown('quit')
    },
    exit: (code) => app.exit(code),
    timeoutMs: QUIT_TIMEOUT_MS,
    onError: (err) => log('error', 'Graceful shutdown error', { error: serializeError(err) }),
    onTimeout: () => log('warn', 'Graceful shutdown did not finish in time; exiting', { timeoutMs: QUIT_TIMEOUT_MS }),
  }))
}

function installLastResortHooks(): void {
  // Global last-resort hooks: log with full error fidelity before the process
  // dies, and also surface to the console as a backstop for the brief window
  // before the records are open. An uncaught exception leaves the process
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
}

function createWindow(): BrowserWindow {
  // Chrome + sizing come from the pure buildMainWindowOptions: the window
  // minimum and opening width are DERIVED from the shared pane minimums and the
  // pane count (see shared/layout-metrics), never a magic literal, so the window
  // can't be shrunk small enough to truncate a pane and doesn't open wider than
  // its panes need. The background is the resolved theme's app surface.
  const windowOptions = buildMainWindowOptions(getVisiblePaneCount())
  const win = createWindowWithUsablePersistedBounds('main-window', () => new BrowserWindow({
    ...windowOptions,
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  }))
  registerMainWindowForLayout(win)
  trackThemedWindow(win)

  hardenWindow(win)

  win.on('closed', () => {
    unregisterMainWindowForLayout(win)
  })

  win.webContents.on('context-menu', (_event, params) => {
    const template = buildTextContextMenuTemplate(mainTranslator(), params, (word) => win.webContents.replaceMisspelling(word))
    if (template) Menu.buildFromTemplate(template).popup({ window: win })
  })

  ownMainWindowContentLoad(
    win,
    process.env['ELECTRON_RENDERER_URL'],
    path.join(__dirname, '../renderer/index.html'),
    (cause) => {
      enterStartupFailure(new Error('ImageQueue could not load its main window.', { cause }), win)
    },
  )
  return win
}

function installAppMenu(): void {
  const apply = (): void => {
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildAppMenuTemplate(mainTranslator(), process.platform)))
  }
  apply()
  onLanguageChanged(apply)
}

async function startUp(): Promise<void> {
  // Set the renderer CSP before any window loads its content. Gate the strict
  // policy on the production-renderer signal (no dev-server URL), not
  // app.isPackaged — so run-built/rebuild (electron-vite preview, which runs
  // unpackaged) still exercise the strict production CSP.
  installContentSecurityPolicy(!process.env['ELECTRON_RENDERER_URL'])
  registerImageProtocol()
  ensureDataDir()
  // Records open immediately after the storage root exists and before any other
  // startup step, so a failure in one of them is logged rather than lost to the
  // console.
  openRecords(getDataDir())
  // The Records window, when open, follows each record the database stores.
  onRecordStored(notifyRecordsChanged)
  // Created before the launch archive, so a quit during it is claimed by the
  // controller and the rest of startup does not run.
  mainWindowController = new MainWindowController({
    platform: process.platform,
    createWindow,
    isStatusIconAvailable: () => statusIconController?.isAvailable() ?? false,
    onHiddenToBackground: () => {
      closeFullscreenView({ refocusMain: false })
      hidePreviewWindow()
    },
    onRestored: showPreviewWindow,
    onPrimaryWindowClosed: () => {
      destroyFullscreenView()
      closePreviewWindow()
      if (startupFailureWindow) return
      if (process.platform !== 'darwin') app.quit()
    },
    dock: app.dock,
  })
  await archiveSession('begin')
  if (mainWindowController.isShuttingDown()) return
  clearTempDir()
  // The saved theme reaches the title bar and the renderer's
  // prefers-color-scheme before any window exists, so launch never shows the OS
  // appearance and then switches. A config that cannot load leaves System, so
  // the startup failure window follows the OS.
  applyThemePreference(loadConfig().general.theme)
  followOsThemeChanges()
  initSession()
  resetOutputTimestampAllocators()
  log('info', 'App started', {
    version: __APP_VERSION__,
    packaged: app.isPackaged,
    debug: DEBUG_ENABLED,
    config: summarizeConfig(loadConfig()),
  })
  // Every launch opens a fresh session, where this launch's images land.
  // Switching or resuming a session logs its own line from session/state.
  log('info', 'Session started', { sessionDir: getSessionDir() })

  persistActiveSession()
  statusIconController = new StatusIconController({
    restoreMainWindow: () => mainWindowController?.restoreOrCreate(),
    retainActivationSurface: () => mainWindowController?.retainActivationSurface(),
    requestQuit: () => app.quit(),
    openOutputFolder,
    setQueuePaused: setQueuePausedAndPublish,
  })
  registerSessionIpc()
  registerQueueIpc()
  registerSettingsIpc(async (config) => {
    // Settings apply on Save, the theme and language included (app-chrome
    // conventions, Theme; localization conventions).
    applyThemePreference(config.general.theme)
    await applyLanguagePreference(config.general.language)
    await statusIconController?.reconcile(config.general.show_status_icon)
    syncPreviewWindow(config.general.show_preview_window)
  })
  registerStateIpc()
  registerDependenciesIpc()
  registerElaboratorsIpc()
  registerConceptsIpc()
  registerAppLogIpc()
  registerRecordsIpc()
  registerAppNoticeIpc()
  registerViewingIpc(() => mainWindowController?.getWindow() ?? null)
  registerNotificationIpc()
  initNotificationWindow()
  startProcessor()
  startWakeLockMonitor()

  // Re-check the managed dependencies if the launch toggle is on and the last
  // check attempt is a day old. Fire-and-forget: never blocks startup, and
  // its result is surfaced passively (pane pointer / modal), never as a prompt.
  void checkDependenciesAtLaunch()

  // The just-in-case data backup is no longer a startup pass (data-backup
  // conventions). It is write-through: every managed-text save records the bytes
  // it just wrote into ~/.imagequeue/backups.sqlite3 strictly after its atomic
  // rename lands (see utils/atomic-write.ts → backup/backup-store.ts). There is
  // nothing to run here — the history is always as current as the last save.

  void statusIconController.reconcile(loadConfig().general.show_status_icon)
  mainWindowController.createInitialWindow()
  syncPreviewWindow(loadConfig().general.show_preview_window)
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
// We close the fullscreen view and notification windows here, before Electron
// starts sending close events to the main window. The fullscreen view's own
// close handler calls event.preventDefault() to convert OS-close into a hide;
// if that fired during quit, the app would get stuck.
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
  await guarded('destroyFullscreenView', () => destroyFullscreenView())
  await guarded('closePreviewWindow', () => closePreviewWindow())
  await guarded('closeRecordsWindow', () => closeRecordsWindow())
  await guarded('closeRecordsReader', () => closeRecordsReader())
  await guarded('closeNotificationWindow', () => closeNotificationWindow())
  await guarded('releaseWakeLock', () => releaseWakeLock())
  log('info', 'Session ended', { reason })
  await guarded('dropCurrentSessionIfEmpty', () => dropCurrentSessionIfEmpty(reason))
  await guarded('closeConceptStore', () => closeConceptStore())
  await guarded('closeBackupStore', () => closeBackupStore())
  await guarded('archiveBinaryStores', () => archiveSession('finish'))
}
