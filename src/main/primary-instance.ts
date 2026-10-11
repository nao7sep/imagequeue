import { drainExports } from './utils/storage-wait'
import { app, BrowserWindow, Menu, powerMonitor } from 'electron'
import path from 'path'
import { loadConfig, ensureDataDir, getDataDir, summarizeConfig } from './config'
import { dropCurrentSessionIfEmpty, initSession, getSessionDir, persistActiveSession, drainSessionWrites, registerSessionIpc, resetOutputTimestampAllocators } from './session'
import { registerQueueIpc } from './queue'
import { startProcessor, stopProcessor } from './backends'
import { registerImageProtocol, registerImageSchemeAsPrivileged } from './image-protocol'
import { registerSettingsIpc } from './settings-ipc'
import { registerStateIpc } from './state-ipc'
import { registerDependenciesIpc } from './dependencies-ipc'
import { checkDependenciesAtLaunch } from './dependencies/service'
import { clearTempDir } from './dependencies/paths'
import { registerElaboratorsIpc } from './elaborators-ipc'
import { listElaborators } from './elaborators'
import { refreshApiKeys } from './config/api-keys-store'
import { closeConceptStore } from './concepts/concept-store'
import { closeBackupStore } from './backup/backup-store'
import { registerConceptsIpc } from './concepts-ipc'
import { registerAppLogIpc } from './app-log-ipc'
import { registerAppNoticeIpc } from './app-notice-ipc'
import { closeFullscreenView, destroyFullscreenView } from './fullscreen-view'
import { registerViewingIpc } from './viewing-ipc'
import { closePreviewWindow, hidePreviewWindow, showPreviewWindow, syncPreviewWindow } from './preview-window'
import { closeNotificationWindow, initNotificationWindow, registerNotificationIpc } from './notification'
import { log, setLoggerDebug, serializeError, shouldEnableDebugLogging } from './logger'
import { onRecordStored, openRecords, closeRecords } from './records'
import { registerRecordsIpc } from './records-ipc'
import { closeRecordsReader } from './records-reader'
import { closeRecordsWindow, notifyRecordsChanged } from './records-window'
import { killAllCliJobsAndWait } from './cli-jobs'
import { cancelAllInFlightAndWait } from './backends/cancellation'
import { getAllModelParams, drainPendingWrites as drainPendingModelParamsWrites } from './model-params'
import { startWakeLockMonitor, releaseWakeLock } from './power-blocker'
import { hardenWindow } from './utils/harden-window'
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
import { createQuitOwner } from './quit-handler'
import { forceExit } from './utils/force-exit'
import { showQuitFailure } from './quit-failure-window'
import { isQuitting, setQuitting } from './quit-state'
import { drainBackendDefaults } from './backend-defaults'
import { resumeAfterCancelledShutdown } from './backends/cancellation'
import { retrySettingsWrites } from './settings-writes'
import { cancelAllBrainstorms, hasActiveBrainstorms } from './brainstorm'
import { cancelAllDependencyOperations, hasActiveDependencyOperations } from './dependencies/operations'
import { startAppReleaseCheck } from './app-release-check'
import { startupFailurePresentation } from './failure-presentation'
import { MainWindowController } from './main-window-lifecycle'
import { StatusIconController } from './status-icon'
import { openSessionsFolder } from './session/open-sessions-folder'
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

// Ordinary storage waits end in a choice; OS shutdown has one total budget.
const QUIT_TIMEOUT_MS = 30_000
const SYSTEM_QUIT_TIMEOUT_MS = 1_500
let startupWork: Promise<void> | null = null
let sessionStarted = false
let backgroundWork: Promise<void> | null = null
let cleanExit = false
let backgroundSettled = false
const quitOwner = createQuitOwner({
  begin: () => {
    cleanExit = false
    backgroundSettled = false
    setQuitting(true)
    mainWindowController?.beginShutdown()
    stopProcessor()
    cancelAllBrainstorms()
    cancelAllDependencyOperations()
    // Signal both families synchronously, before any persistence wait.
    backgroundWork = Promise.all([
      cancelAllInFlightAndWait(5_000),
      killAllCliJobsAndWait({ timeoutMs: 5_000 }),
    ]).then((results) => { backgroundSettled = results.every((result) => result.settled) })
  },
  save: async () => {
    await startupWork
    if (!sessionStarted) return
    await Promise.all([retrySettingsWrites(), drainExports()])
    await Promise.all([drainBackendDefaults(), drainPendingModelParamsWrites()])
    if (!backgroundWork) {
      backgroundWork = Promise.all([
        cancelAllInFlightAndWait(5_000), killAllCliJobsAndWait({ timeoutMs: 5_000 }),
      ]).then((results) => { backgroundSettled = results.every((result) => result.settled) })
    }
    await backgroundWork
    backgroundWork = null
    if (!backgroundSettled) throw new Error('Active image or tool work has not settled before quit')
    // A prior failed save remains pending; Retry republishes the latest state
    // through its ordered writer after all existing physical writes settle.
    try { await drainSessionWrites() } catch (error) {
      log('warn', 'Retrying the pending session save', { error: serializeError(error) })
    }
    await persistActiveSession()
  },
  cleanup: async () => {
    await gracefulShutdown('quit')
    cleanExit = backgroundSettled && !hasActiveBrainstorms() && !hasActiveDependencyOperations()
  },
  cancel: () => {
    setQuitting(false)
    mainWindowController?.cancelShutdown()
    resumeAfterCancelledShutdown()
    startProcessor()
  },
  question: (signal) => showQuitFailure(signal, () => quitOwner.sessionEnd(), mainWindowController?.getWindow() ?? undefined),
  exit: () => {
    if (cleanExit) app.exit(0)
    else {
      // Electron/Node's exit joins native workers. A worker stuck inside SQLite
      // can prevent that join forever; OS termination does not join it. Used
      // only after a deadline or explicit abandonment, never to claim a save.
      forceExit()
    }
  },
  timeoutMs: QUIT_TIMEOUT_MS,
  systemTimeoutMs: SYSTEM_QUIT_TIMEOUT_MS,
  onError: (error) => log('error', 'Saving before quit failed', { error: serializeError(error) }),
})

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
    powerMonitor.on('shutdown', quitOwner.sessionEnd)
    await settleLanguage()
    registerLanguageIpc()
    installAppMenu()
    // The startup body throws when a store cannot be recovered, such as a
    // config.json that cannot be read or set aside (config-store.ts). Without this catch
    // the rejection lands in the unhandledRejection hook, which logs and does NOT
    // exit — a running process with no window and no dialog is not a halt
    // (storage-path conventions: a halt names the store and reaches the user).
      startupWork = startUp()
      await startupWork
    } catch (err) {
      enterStartupFailure(err)
    }
  })

  app.on('before-quit', quitOwner.beforeQuit)

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
    // Crash handling cannot safely resume application writes. Normal edits
    // have already reached their main-process owners; the OS reclaims resources.
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
  // Created before store initialization so quit owns the whole startup lifetime.
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
    onSessionEnd: quitOwner.sessionEnd,
  })
  clearTempDir()
  // The saved theme reaches the title bar and the renderer's
  // prefers-color-scheme before any window exists, so launch never shows the OS
  // appearance and then switches. A config that cannot load leaves System, so
  // the startup failure window follows the OS.
  applyThemePreference(loadConfig().general.theme)
  followOsThemeChanges()
  // Load the small settings stores before any interactive window exists;
  // runtime consumers use their initialized snapshots and asynchronous saves.
  listElaborators()
  getAllModelParams()
  await refreshApiKeys()
  await initSession()
  sessionStarted = true
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

  await persistActiveSession()
  statusIconController = new StatusIconController({
    restoreMainWindow: () => mainWindowController?.restoreOrCreate(),
    retainActivationSurface: () => mainWindowController?.retainActivationSurface(),
    requestQuit: () => app.quit(),
    openSessionsFolder,
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
  startAppReleaseCheck()
  initNotificationWindow()
  if (!isQuitting()) startProcessor()
  startWakeLockMonitor()

  // Re-check the managed dependencies if the launch toggle is on and the last
  // check attempt is a day old. Fire-and-forget: never blocks startup, and
  // its result is surfaced passively (pane pointer / modal), never as a prompt.
  if (!isQuitting()) void checkDependenciesAtLaunch()

  if (!isQuitting()) {
    void statusIconController.reconcile(loadConfig().general.show_status_icon)
    mainWindowController.createInitialWindow()
    syncPreviewWindow(loadConfig().general.show_preview_window)
  }
  mainWindowController.markStartupComplete()

  app.on('activate', () => {
    void mainWindowController?.restoreOrCreate()
  })
}

// Only optional work remains here. The quit owner bounds this entire phase;
// no native worker termination or independent per-step timeout extends it.
async function gracefulShutdown(reason: string): Promise<void> {
  statusIconController?.dispose()
  mainWindowController?.dispose()
  destroyFullscreenView()
  closePreviewWindow()
  closeRecordsWindow()
  closeNotificationWindow()
  releaseWakeLock()
  log('info', 'Session ended', { reason })
  await Promise.all([
    dropCurrentSessionIfEmpty(reason),
    closeConceptStore(),
    closeBackupStore(),
    closeRecordsReader(),
  ])
  await closeRecords()
}
