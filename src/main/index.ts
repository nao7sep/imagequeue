import { app, BrowserWindow, dialog, Menu, nativeTheme } from 'electron'
import path from 'path'
import { loadConfig, ensureDataDir, getLogsDir, summarizeConfig } from './config'
import { dropCurrentSessionIfEmpty, drainPendingDraftWrites, initSession, getSessionDir, persistActiveSession, registerSessionIpc, resetOutputTimestampAllocators } from './session'
import { registerQueueIpc } from './queue'
import { startProcessor } from './backends'
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
import { killAllCliJobs } from './cli-jobs'
import { drainPendingWrites as drainPendingModelParamsWrites } from './model-params'
import { startWakeLockMonitor, releaseWakeLock } from './power-blocker'
import { hardenWindow } from './utils/harden-window'
import { queueManager } from './queue/queue-manager'
import { installContentSecurityPolicy } from './csp'
import { buildMainWindowOptions } from './window-options'
import { getVisiblePanes } from '../shared/layout-metrics'
import { hasApiKey } from './config/api-keys-store'
import { CLOUD_BACKEND_IDS_IN_UI_ORDER, IMAGE_BACKEND_SECRET } from '../shared/types'
import type { Platform } from '../shared/electron-api'
import { startupFailureMessage } from './startup-error'

let mainWin: BrowserWindow | null = null

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

// How many panes the right-hand group will show, from the one shared rule the
// renderer's layout also uses (shared/layout-metrics), fed the same two inputs:
// which keys resolve (environment first — the renderer learns this only through
// settings:getApiKeyPresence, but here it is a direct call) and which backends
// hold tasks. Deriving both sides from one rule is what keeps the window minimum
// from disagreeing with the panes actually painted.
function visiblePaneCount(): number {
  const keyed = CLOUD_BACKEND_IDS_IN_UI_ORDER.filter((backend) =>
    hasApiKey(IMAGE_BACKEND_SECRET[backend])
  )
  const tasks = queueManager.getAllStoredTasks()
  const occupied = CLOUD_BACKEND_IDS_IN_UI_ORDER.filter((backend) => (tasks[backend]?.length ?? 0) > 0)
  return getVisiblePanes(process.platform as Platform, keyed, occupied).length
}

// Re-apply the window minimum after anything that can change the pane count —
// a key stored or cleared, a session's tasks restored. Electron grows a window
// that sits below a raised minimum, which is the window fitting a column that
// just appeared; a lowered minimum only widens what the user may drag to, and
// never resizes anything on its own.
export function refreshWindowMinimumSize(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  const { minWidth, minHeight } = buildMainWindowOptions(visiblePaneCount())
  win.setMinimumSize(minWidth, minHeight)
}

function createWindow(): void {
  // Chrome + sizing come from the pure buildMainWindowOptions: the window
  // minimum and opening width are DERIVED from the shared pane minimums and the
  // pane count (see shared/layout-metrics), never a magic literal, so the window
  // can't be shrunk small enough to truncate a pane and doesn't open wider than
  // its panes need. themeSource is applied to nativeTheme in app.whenReady()
  // from the same source.
  const { themeSource: _themeSource, ...windowOptions } = buildMainWindowOptions(visiblePaneCount())
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
  nativeTheme.themeSource = buildMainWindowOptions(visiblePaneCount()).themeSource
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
  registerStateIpc()
  registerDependenciesIpc()
  registerElaboratorsIpc()
  registerConceptsIpc()
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

  // The just-in-case data backup is no longer a startup pass (data-backup
  // conventions). It is write-through: every managed-text save records the bytes
  // it just wrote into ~/.imagequeue/backups.sqlite3 strictly after its atomic
  // rename lands (see utils/atomic-write.ts → backup/backup-store.ts). There is
  // nothing to run here — the history is always as current as the last save.

  createWindow()

  app.on('activate', () => {
    if (!mainWin || mainWin.isDestroyed()) {
      createWindow()
    }
  })
}

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
