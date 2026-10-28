import { drainExports } from './utils/storage-wait'
import { handle } from './ipc-boundary'
import { app, BrowserWindow, Menu, powerMonitor, dialog } from 'electron'
import path from 'path'
import { loadConfig, ensureDataDir, getDataDir, onConfigSaved, summarizeConfig, updateConfig } from './config'
import { notifySettingsChanged } from './settings-changed'
import { dropCurrentSessionIfEmpty, initSession, getSessionDir, persistActiveSession, drainSessionWrites, registerSessionIpc, resetOutputTimestampAllocators } from './session'
import { queueManager, registerQueueIpc } from './queue'
import { startProcessor, stopProcessor } from './backends'
import { registerAudioProtocol } from './audio-protocol'
import { registerImageProtocol, registerMediaSchemesAsPrivileged } from './image-protocol'
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
import { registerViewingIpc, WINDOW_COMMAND_CHANNEL } from './viewing-ipc'
import { closePreviewWindow, hidePreviewWindow, showPreviewWindow, syncPreviewWindow } from './preview-window'
import { closeNotificationWindow, initNotificationWindow, registerNotificationIpc } from './notification'
import { log, setLoggerDebug, serializeError, shouldEnableDebugLogging } from './logger'
import { onRecordStored, openRecords, closeRecords } from './records'
import { registerRecordsIpc } from './records-ipc'
import { closeRecordsReader } from './records-reader'
import { closeRecordsWindow, hideRecordsWindow, notifyRecordsChanged, showRecordsWindow } from './records-window'
import { hasRunningCliJobs, killAllCliJobsAndWait } from './cli-jobs'
import { CLI_HARD_KILL_DELAY_MS } from '../shared/cli-jobs'
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
import { showQuitQuestion } from './quit-failure-window'
import { unsavedDrafts, registerUnsavedDraftsIpc } from './unsaved-drafts'
import { hasQuitWork, type QuitWork } from '../shared/quit'
import { isQuitting, setQuitting } from './quit-state'
import { drainBackendDefaults } from './backend-defaults'
import { resumeAfterCancelledShutdown } from './backends/cancellation'
import { retrySettingsWrites } from './settings-writes'
import { cancelAllBrainstorms, hasActiveBrainstorms } from './brainstorm'
import { cancelAllDependencyOperations, hasActiveDependencyOperations, hasUserDependencyOperations } from './dependencies/operations'
import { installLastResortHooks } from './last-resort-hooks'
import { startupFailurePresentation } from './failure-presentation'
import { MainWindowController } from './main-window-lifecycle'
import { StatusIconController } from './status-icon'
import { openSessionsFolder } from './session/open-sessions-folder'
import { setQueuePausedAndPublish } from './queue/control-actions'
import { loadMainWindowContent } from './main-window-content'
import { PrimaryRendererRecovery } from './primary-renderer-recovery'
import { applyLocalePreferences, mainTranslator, onLanguageChanged, registerLanguageIpc, settleLanguage } from './i18n'
import { buildAppMenuTemplate, buildTextContextMenuTemplate } from './app-menu'
import { PRELOAD_PATH } from './renderer-surface'
import { startLauncherControl } from './launcher-control'

let mainWindowController: MainWindowController<BrowserWindow> | null = null
let statusIconController: StatusIconController | null = null
let startupFailureWindow: BrowserWindow | null = null
const primaryRenderers = new WeakMap<BrowserWindow, PrimaryRendererRecovery>()

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
// What an ordinary quit would end: images generating, prompt elaboration, tool work
// the user started, and main-window dialogs holding unsaved edits.
function quitWork(): QuitWork {
  return {
    generating: queueManager.generatingCount(),
    elaborating: hasActiveBrainstorms(),
    tools: hasRunningCliJobs() || hasUserDependencyOperations(),
    drafts: unsavedDrafts(),
  }
}

// A cancelled quit never leaves the app with no window showing and no icon to
// bring one back (window-conventions, Background mode).
function keepReachable(): void {
  if (statusIconController?.isAvailable()) return
  const main = mainWindowController?.getWindow()
  if (main && main.isVisible() && !main.isMinimized()) return
  void mainWindowController?.restoreOrCreate()
}

const quitOwner = createQuitOwner({
  confirm: (signal) => {
    if (!sessionStarted) return true
    const work = quitWork()
    if (!hasQuitWork(work)) return true
    return showQuitQuestion({ kind: 'confirm', work, platform: process.platform }, signal, () => quitOwner.sessionEnd(),
      mainWindowController?.getWindow() ?? undefined).then((choice) => choice === 'quit')
  },
  declined: keepReachable,
  begin: () => {
    cleanExit = false
    backgroundSettled = false
    setQuitting(true)
    mainWindowController?.beginShutdown()
    stopProcessor()
    cancelAllBrainstorms()
    cancelAllDependencyOperations()
    // Signal both families synchronously, before any persistence wait.
    // The 500ms hard-kill grace fits inside the 1500ms OS exit budget.
    backgroundWork = Promise.all([
      cancelAllInFlightAndWait(5_000),
      killAllCliJobsAndWait({ killGraceMs: CLI_HARD_KILL_DELAY_MS, timeoutMs: 5_000 }),
    ]).then((results) => { backgroundSettled = results.every((result) => result.settled) })
  },
  save: async () => {
    // A failed startup is reported by its own window; quitting from it has
    // nothing of this launch to save, so its error is not a save failure.
    await startupWork?.catch(() => undefined)
    if (!sessionStarted) return
    await Promise.all([retrySettingsWrites(), drainExports()])
    await Promise.all([drainBackendDefaults(), drainPendingModelParamsWrites()])
    if (!backgroundWork) {
      backgroundWork = Promise.all([
        cancelAllInFlightAndWait(5_000), killAllCliJobsAndWait({ killGraceMs: CLI_HARD_KILL_DELAY_MS, timeoutMs: 5_000 }),
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
    keepReachable()
  },
  question: (signal) => showQuitQuestion({ kind: 'saveFailed' }, signal, () => quitOwner.sessionEnd(), mainWindowController?.getWindow() ?? undefined),
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
  registerMediaSchemesAsPrivileged()

  const launcherControl = startLauncherControl({
    status: () => {
      if (startupFailureWindow) return 'failed'
      const main = mainWindowController?.getWindow()
      return sessionStarted && main && !main.isDestroyed() && primaryRenderers.get(main)?.isReady() === true
        ? 'ready' : 'starting'
    },
    quit: () => app.quit(),
  })
  // Initialization starts before ready, but its failure is presented through
  // the normal startup surface once language and native menus are available.
  void launcherControl.catch(() => undefined)
  app.on('will-quit', () => {
    // Closing owns live sockets without extending the OS shutdown budget.
    void launcherControl.then((control) => control?.close()).catch((error) => {
      log('error', 'Closing launcher control failed', { error: serializeError(error) })
    })
  })

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
      await launcherControl
      startupWork = startUp()
      await startupWork
    } catch (err) {
      enterStartupFailure(err)
    }
  })

  app.on('before-quit', quitOwner.beforeQuit)

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
      preload: PRELOAD_PATH,
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

  let failureNoticePending = false
  const renderer = new PrimaryRendererRecovery({
    load: () => loadMainWindowContent(win, process.env['ELECTRON_RENDERER_URL'], path.join(__dirname, '../renderer/index.html')),
    isDestroyed: () => win.isDestroyed(),
    onStartupFailure: (cause) => enterStartupFailure(new Error('ImageQueue could not load its main window.', { cause }), win),
    onRuntimeFailure: (error) => {
      log('error', 'The primary window needs recovery', { error: serializeError(error) })
      // Native UI does not depend on the failed renderer. A background failure
      // never reveals a window; explicit restore will attempt recovery instead.
      if (!win.isVisible() || win.isMinimized() || isQuitting() || failureNoticePending) return
      failureNoticePending = true
      const { t } = mainTranslator()
      void dialog.showMessageBox(win, {
        type: 'error', title: 'ImageQueue', message: t('mainWindow.recoveryFailed'),
        buttons: [t('common.close')], noLink: true,
      }).catch((cause) => {
        log('error', 'The primary window recovery notice could not open', { error: serializeError(cause) })
      }).finally(() => { failureNoticePending = false })
    },
  })
  primaryRenderers.set(win, renderer)
  win.webContents.on('render-process-gone', (_event, details) => {
    mainDialogOpen = false
    applyAppMenu()
    renderer.rendererGone(details)
  })
  renderer.start()
  return win
}

// Settings opens in the main window, brought forward first; a dialog in front
// of it disables About and Settings until it closes.
let mainDialogOpen = false
let applyAppMenu = (): void => {}

function openSettingsFromMenu(): void {
  void mainWindowController?.restoreOrCreate().then(() => {
    const main = mainWindowController?.getWindow()
    if (main && !main.isDestroyed() && primaryRenderers.get(main)?.isReady() !== false) main.webContents.send(WINDOW_COMMAND_CHANNEL, 'settings')
  })
}

function installAppMenu(): void {
  applyAppMenu = (): void => {
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildAppMenuTemplate(mainTranslator(), process.platform, {
      dialogOpen: mainDialogOpen,
      openSettings: openSettingsFromMenu,
    })))
  }
  applyAppMenu()
  onLanguageChanged(() => applyAppMenu())
}

function registerMenuStateIpc(): void {
  handle('menu:dialogOpen', (event, open: unknown) => {
    if (event.sender !== mainWindowController?.getWindow()?.webContents || typeof open !== 'boolean' || open === mainDialogOpen) return
    mainDialogOpen = open
    applyAppMenu()
  })
}

async function startUp(): Promise<void> {
  // Set the renderer CSP before any window loads its content. Gate the strict
  // policy on the production-renderer signal (no dev-server URL), not
  // app.isPackaged, so every production renderer, packaged or not, runs under
  // the strict policy.
  installContentSecurityPolicy(!process.env['ELECTRON_RENDERER_URL'])
  registerImageProtocol()
  registerAudioProtocol()
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
    prepareWindow: (win) => primaryRenderers.get(win)!.restore(),
    isStatusIconAvailable: () => statusIconController?.isAvailable() ?? false,
    // Background mode: every window goes with the main window to the icon and
    // returns only with it (window-conventions, Background mode).
    onHiddenToBackground: () => {
      closeFullscreenView({ refocusOrigin: false })
      hidePreviewWindow()
      hideRecordsWindow()
    },
    onRestored: () => {
      showPreviewWindow()
      showRecordsWindow()
    },
    onPrimaryWindowClosed: () => {
      destroyFullscreenView()
      closePreviewWindow()
      if (startupFailureWindow) return
      // Without an icon to return through, the app ends on every platform.
      if (!statusIconController?.isAvailable()) app.quit()
    },
    requestQuit: () => app.quit(),
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
    notices: {
      enabled: () => loadConfig().notifications.notifications_enabled,
      setEnabled: async (enabled) => {
        await updateConfig((draft) => { draft.notifications.notifications_enabled = enabled })
        notifySettingsChanged(mainWindowController?.getWindow() ?? null)
      },
      onChanged: onConfigSaved,
    },
  })
  registerSessionIpc()
  registerQueueIpc()
  registerSettingsIpc(async (config) => {
    // Settings apply on Save, the theme and language included (app-chrome
    // conventions, Theme; localization conventions).
    applyThemePreference(config.general.theme)
    await applyLocalePreferences(config.general.language, config.general.time_zone)
    await statusIconController?.reconcile(config.general.show_status_icon)
    // Turning the setting on is a request for this window alone.
    syncPreviewWindow(config.general.show_preview_window, { focus: true })
  })
  registerStateIpc()
  registerDependenciesIpc()
  registerElaboratorsIpc()
  registerConceptsIpc()
  registerAppLogIpc()
  registerRecordsIpc()
  registerAppNoticeIpc()
  registerViewingIpc(() => mainWindowController?.getWindow() ?? null)
  registerUnsavedDraftsIpc(() => mainWindowController?.getWindow()?.webContents ?? null)
  registerMenuStateIpc()
  registerNotificationIpc()
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
    syncPreviewWindow(loadConfig().general.show_preview_window, { focus: false })
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
