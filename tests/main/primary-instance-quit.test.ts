import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { until } from '../renderer/until'

// Delivers the operating system's quit signals into the primary instance's own
// handlers: macOS logout, restart and shutdown arrive as powerMonitor
// 'shutdown' followed by the ordinary terminate route (before-quit); Windows
// logoff and shutdown arrive as the main window's query-session-end and
// session-end. Every store, window and worker owner is a stand-in, so these
// tests cover the routing and the quit sequence, not the steps' own behavior
// (quit-handler.test.ts owns the deadline and question rules).

const h = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => unknown
  const appListeners = new Map<string, Listener[]>()
  const powerListeners = new Map<string, Listener[]>()
  const on = (map: Map<string, Listener[]>) => vi.fn((event: string, listener: Listener) => {
    map.set(event, [...(map.get(event) ?? []), listener])
  })
  const controllers: Array<{ options: Record<string, unknown>; markStartupComplete: ReturnType<typeof vi.fn>; beginShutdown: ReturnType<typeof vi.fn>; restoreOrCreate: ReturnType<typeof vi.fn> }> = []
  return {
    appListeners,
    powerListeners,
    app: {
      on: on(appListeners),
      whenReady: vi.fn(() => Promise.resolve()),
      exit: vi.fn(),
      quit: vi.fn(),
      isPackaged: false,
      dock: undefined,
    },
    powerMonitor: { on: on(powerListeners) },
    controllers,
    startUpFails: { value: false },
    iconAvailable: { value: true },
    createPrimary: { value: false },
    mainWindow: { value: null as null | { isDestroyed: () => boolean; webContents: { send: ReturnType<typeof vi.fn> } } },
    emit(map: Map<string, Listener[]>, event: string, ...args: unknown[]): void {
      for (const listener of map.get(event) ?? []) listener(...args)
    },
  }
})

vi.mock('electron', () => ({
  app: h.app,
  powerMonitor: h.powerMonitor,
  dialog: { showMessageBox: vi.fn(async () => ({ response: 0 })) },
  BrowserWindow: vi.fn(),
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
}))
vi.mock('../../src/main/config', () => ({
  loadConfig: vi.fn(() => ({ general: { theme: 'system', show_status_icon: false, show_preview_window: false } })),
  ensureDataDir: vi.fn(),
  getDataDir: vi.fn(() => '/data'),
  summarizeConfig: vi.fn(),
  updateConfig: vi.fn(async () => undefined),
  onConfigSaved: vi.fn(() => () => undefined),
}))
vi.mock('../../src/main/session', () => ({
  dropCurrentSessionIfEmpty: vi.fn(async () => undefined),
  initSession: vi.fn(async () => undefined),
  getSessionDir: vi.fn(() => '/data/sessions/s'),
  persistActiveSession: vi.fn(async () => undefined),
  drainSessionWrites: vi.fn(async () => undefined),
  registerSessionIpc: vi.fn(),
  resetOutputTimestampAllocators: vi.fn(),
  onSessionCommandSettled: vi.fn(),
}))
vi.mock('../../src/main/queue', () => ({ registerQueueIpc: vi.fn(), queueManager: { generatingCount: vi.fn(() => 0) } }))
vi.mock('../../src/main/backends', () => ({ processQueues: vi.fn() }))
vi.mock('../../src/main/audio-protocol', () => ({ registerAudioProtocol: vi.fn() }))
vi.mock('../../src/main/image-protocol', () => ({ registerImageProtocol: vi.fn(), registerMediaSchemesAsPrivileged: vi.fn() }))
vi.mock('../../src/main/settings-ipc', () => ({ registerSettingsIpc: vi.fn(), drainExports: vi.fn(async () => undefined) }))
vi.mock('../../src/main/settings-changed', () => ({ notifySettingsChanged: vi.fn() }))
vi.mock('../../src/main/state-ipc', () => ({ registerStateIpc: vi.fn() }))
vi.mock('../../src/main/dependencies-ipc', () => ({ registerDependenciesIpc: vi.fn() }))
vi.mock('../../src/main/dependencies/service', () => ({ checkDependenciesAtLaunch: vi.fn(async () => undefined) }))
vi.mock('../../src/main/dependencies/paths', () => ({ clearTempDir: vi.fn() }))
vi.mock('../../src/main/elaborators-ipc', () => ({ registerElaboratorsIpc: vi.fn() }))
vi.mock('../../src/main/elaborators', () => ({ listElaborators: vi.fn() }))
vi.mock('../../src/main/config/api-keys-store', () => ({ refreshApiKeys: vi.fn(async () => undefined) }))
vi.mock('../../src/main/concepts/concept-store', () => ({ closeConceptStore: vi.fn(async () => undefined) }))
vi.mock('../../src/main/backup/backup-store', () => ({ closeBackupStore: vi.fn(async () => undefined) }))
vi.mock('../../src/main/concepts-ipc', () => ({ registerConceptsIpc: vi.fn() }))
vi.mock('../../src/main/app-log-ipc', () => ({ registerAppLogIpc: vi.fn() }))
vi.mock('../../src/main/app-notice-ipc', () => ({ registerAppNoticeIpc: vi.fn() }))
vi.mock('../../src/main/fullscreen-view', () => ({ closeFullscreenView: vi.fn(), destroyFullscreenView: vi.fn() }))
vi.mock('../../src/main/viewing-ipc', () => ({ registerViewingIpc: vi.fn(), WINDOW_COMMAND_CHANNEL: 'window:command' }))
vi.mock('../../src/main/ipc-boundary', () => ({ handle: vi.fn() }))
const { handle } = await import('../../src/main/ipc-boundary')
vi.mock('../../src/main/preview-window', () => ({
  closePreviewWindow: vi.fn(), hidePreviewWindow: vi.fn(), showPreviewWindow: vi.fn(), syncPreviewWindow: vi.fn(),
}))
vi.mock('../../src/main/notification', () => ({
  closeNotificationWindow: vi.fn(), initNotificationWindow: vi.fn(), registerNotificationIpc: vi.fn(),
}))
vi.mock('../../src/main/logger', () => ({
  log: vi.fn(), setLoggerDebug: vi.fn(), serializeError: vi.fn((error: unknown) => String(error)), shouldEnableDebugLogging: vi.fn(() => false),
}))
vi.mock('../../src/main/records', () => ({ onRecordStored: vi.fn(), openRecords: vi.fn(), closeRecords: vi.fn(async () => undefined) }))
vi.mock('../../src/main/records-ipc', () => ({ registerRecordsIpc: vi.fn() }))
vi.mock('../../src/main/records-window', () => ({ closeRecordsWindow: vi.fn(), notifyRecordsChanged: vi.fn(), hideRecordsWindow: vi.fn(), showRecordsWindow: vi.fn() }))
vi.mock('../../src/main/cli-jobs', () => ({ stopAllCliJobs: vi.fn(async () => undefined), hasRunningCliJobs: vi.fn(() => false) }))
vi.mock('../../src/main/backends/cancellation', () => ({ stopAllRuns: vi.fn(async () => undefined) }))
vi.mock('../../src/main/model-params', () => ({ getAllModelParams: vi.fn(), drainPendingWrites: vi.fn(async () => undefined) }))
vi.mock('../../src/main/power-blocker', () => ({ startWakeLockMonitor: vi.fn(), releaseWakeLock: vi.fn() }))
vi.mock('../../src/main/utils/harden-window', () => ({ hardenWindow: vi.fn() }))
vi.mock('../../src/main/csp', () => ({
  installContentSecurityPolicy: vi.fn(() => { if (h.startUpFails.value) throw new Error('config.json cannot be read') }),
}))
vi.mock('../../src/main/window-options', () => ({ buildMainWindowOptions: vi.fn(() => ({})) }))
vi.mock('../../src/main/theme', () => ({
  applyThemePreference: vi.fn(), followOsThemeChanges: vi.fn(), trackThemedWindow: vi.fn(), windowBackground: vi.fn(),
}))
vi.mock('../../src/main/window-state-recovery', () => ({ createWindowWithUsablePersistedBounds: vi.fn() }))
vi.mock('../../src/main/main-window-layout', () => ({
  getVisiblePaneCount: vi.fn(() => 1), registerMainWindowForLayout: vi.fn(), unregisterMainWindowForLayout: vi.fn(),
}))
vi.mock('../../src/main/startup-failure-window', () => ({ createStartupFailureWindow: vi.fn(() => ({ on: vi.fn(), isDestroyed: () => false })) }))
vi.mock('../../src/main/utils/force-exit', () => ({ forceExit: vi.fn() }))
vi.mock('../../src/main/quit-failure-window', () => ({ showQuitQuestion: vi.fn(async () => 'cancel') }))
vi.mock('../../src/main/backend-defaults', () => ({ drainBackendDefaults: vi.fn(async () => undefined) }))
vi.mock('../../src/main/settings-writes', () => ({ retrySettingsWrites: vi.fn(async () => undefined) }))
vi.mock('../../src/main/brainstorm', () => ({ cancelAllBrainstorms: vi.fn(), hasActiveBrainstorms: vi.fn(() => false) }))
vi.mock('../../src/main/dependencies/operations', () => ({
  cancelAllDependencyOperations: vi.fn(), hasActiveDependencyOperations: vi.fn(() => false), hasUserDependencyOperations: vi.fn(() => false),
}))
vi.mock('../../src/main/unsaved-drafts', () => ({ unsavedDrafts: vi.fn(() => []), registerUnsavedDraftsIpc: vi.fn() }))
vi.mock('../../src/main/last-resort-hooks', () => ({ installLastResortHooks: vi.fn() }))
vi.mock('../../src/main/failure-presentation', () => ({ startupFailurePresentation: vi.fn(() => ({ key: 'startup' })) }))
vi.mock('../../src/main/main-window-lifecycle', () => ({
  MainWindowController: vi.fn(function (this: Record<string, unknown>, options: Record<string, unknown>) {
    const controller = {
      options,
      markStartupComplete: vi.fn(),
      createInitialWindow: vi.fn(() => {
        if (h.createPrimary.value) h.mainWindow.value = (options['createWindow'] as () => NonNullable<typeof h.mainWindow.value>)()
      }),
      beginShutdown: vi.fn(),
      cancelShutdown: vi.fn(),
      dispose: vi.fn(),
      getWindow: vi.fn(() => h.mainWindow.value),
      restoreOrCreate: vi.fn(async () => undefined),
      retainActivationSurface: vi.fn(async () => undefined),
    }
    h.controllers.push(controller)
    return controller
  }),
}))
vi.mock('../../src/main/status-icon', () => ({
  StatusIconController: vi.fn(function () { return { reconcile: vi.fn(async () => undefined), dispose: vi.fn(), isAvailable: () => h.iconAvailable.value } }),
}))
vi.mock('../../src/main/session/open-sessions-folder', () => ({ openSessionsFolder: vi.fn() }))
vi.mock('../../src/main/queue/control-actions', () => ({ setQueuePausedAndPublish: vi.fn() }))
vi.mock('../../src/main/main-window-content', () => ({ loadMainWindowContent: vi.fn(async () => undefined) }))
vi.mock('../../src/main/i18n', () => ({
  applyLocalePreferences: vi.fn(async () => undefined),
  mainTranslator: vi.fn(() => ({ t: (key: string) => key })),
  onLanguageChanged: vi.fn(),
  registerLanguageIpc: vi.fn(),
  settleLanguage: vi.fn(async () => undefined),
}))
vi.mock('../../src/main/app-menu', () => ({ buildAppMenuTemplate: vi.fn(() => []), buildTextContextMenuTemplate: vi.fn() }))

const { registerMediaSchemesAsPrivileged } = await import('../../src/main/image-protocol')
const session = await import('../../src/main/session')
const records = await import('../../src/main/records')
const { showQuitQuestion: showQuitFailure } = await import('../../src/main/quit-failure-window')
const { queueManager } = await import('../../src/main/queue')
const { hideRecordsWindow, showRecordsWindow } = await import('../../src/main/records-window')
const { hidePreviewWindow, showPreviewWindow } = await import('../../src/main/preview-window')
const { hasActiveBrainstorms, cancelAllBrainstorms } = await import('../../src/main/brainstorm')
const { forceExit } = await import('../../src/main/utils/force-exit')
const { stopAllCliJobs } = await import('../../src/main/cli-jobs')
const { createStartupFailureWindow } = await import('../../src/main/startup-failure-window')

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  h.appListeners.clear()
  h.powerListeners.clear()
  h.controllers.length = 0
  h.startUpFails.value = false
  h.iconAvailable.value = true
  h.createPrimary.value = false
  h.mainWindow.value = null
  vi.mocked(queueManager.generatingCount).mockReturnValue(0)
  vi.mocked(hasActiveBrainstorms).mockReturnValue(false)
  vi.mocked(showQuitFailure).mockImplementation(async () => 'cancel')
  vi.mocked(session.persistActiveSession).mockResolvedValue(undefined as never)
})

async function launch(): Promise<void> {
  const { runPrimaryInstance } = await import('../../src/main/primary-instance')
  runPrimaryInstance()
  if (h.startUpFails.value) await until(() => expect(createStartupFailureWindow).toHaveBeenCalledOnce())
  else await until(() => expect(h.controllers[0]?.markStartupComplete).toHaveBeenCalledOnce())
}

function beforeQuit(): { preventDefault: ReturnType<typeof vi.fn> } {
  const event = { preventDefault: vi.fn() }
  h.emit(h.appListeners, 'before-quit', event)
  return event
}

describe('primary instance quit routes', () => {
  it('macOS logout saves the session and ends without a question, a veto or optional cleanup', async () => {
    await launch()
    // Electron emits powerMonitor 'shutdown' on NSWorkspaceWillPowerOff, then
    // terminates through before-quit unless a listener prevented it.
    const shutdown = { preventDefault: vi.fn() }
    h.emit(h.powerListeners, 'shutdown', shutdown)
    const quit = beforeQuit()

    await until(() => expect(forceExit).toHaveBeenCalledOnce())
    expect(stopAllCliJobs).toHaveBeenCalled()
    expect(shutdown.preventDefault).not.toHaveBeenCalled()
    expect(quit.preventDefault).toHaveBeenCalledOnce()
    expect(session.persistActiveSession).toHaveBeenCalledTimes(2) // startup, then quit
    expect(h.controllers[0]!.beginShutdown).toHaveBeenCalledOnce()
    expect(showQuitFailure).not.toHaveBeenCalled()
    // Optional disposal belongs only to ordinary quit's budget.
    expect(records.closeRecords).not.toHaveBeenCalled()
    expect(h.app.exit).not.toHaveBeenCalled()
  })

  it('a failed save during logout exits without asking', async () => {
    await launch()
    vi.mocked(session.persistActiveSession).mockRejectedValue(new Error('disk full'))
    h.emit(h.powerListeners, 'shutdown')

    await until(() => expect(forceExit).toHaveBeenCalledOnce())
    expect(showQuitFailure).not.toHaveBeenCalled()
  })

  it('Windows logoff reaches the same takeover through the main window', async () => {
    await launch()
    const onSessionEnd = h.controllers[0]!.options['onSessionEnd'] as () => void
    expect(onSessionEnd).toBe(h.powerListeners.get('shutdown')![0])
    onSessionEnd()

    await until(() => expect(forceExit).toHaveBeenCalledOnce())
    expect(session.persistActiveSession).toHaveBeenCalledTimes(2)
    expect(showQuitFailure).not.toHaveBeenCalled()
  })

  it('ordinary quit saves, disposes and exits cleanly', async () => {
    await launch()
    const quit = beforeQuit()

    await until(() => expect(h.app.exit).toHaveBeenCalledExactlyOnceWith(0))
    expect(quit.preventDefault).toHaveBeenCalledOnce()
    expect(session.persistActiveSession).toHaveBeenCalledTimes(2)
    expect(records.closeRecords).toHaveBeenCalledOnce()
    expect(forceExit).not.toHaveBeenCalled()
  })

  it('quitting after a failed startup does not report a save failure', async () => {
    h.startUpFails.value = true
    await launch()
    beforeQuit()

    await until(() => expect(h.app.exit).toHaveBeenCalledExactlyOnceWith(0))
    expect(showQuitFailure).not.toHaveBeenCalled()
    expect(session.persistActiveSession).not.toHaveBeenCalled()
  })

  it.each([['win32', true, 0], ['darwin', true, 0], ['win32', false, 1], ['darwin', false, 1]] as const)(
    'losing the primary window on %s with the icon %s requests quit %i times', async (value, icon, quits) => {
      await launch()
      h.iconAvailable.value = icon
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
      Object.defineProperty(process, 'platform', { configurable: true, value })
      try {
        ;(h.controllers[0]!.options['onPrimaryWindowClosed'] as () => void)()
      } finally {
        Object.defineProperty(process, 'platform', platform)
      }
      expect(h.app.quit).toHaveBeenCalledTimes(quits)
    })

  // Quit asks before stopping images that are generating (unsaved-edits-conventions).
  it('asks before stopping generating images, standalone while no window shows, and stops nothing on Cancel', async () => {
    await launch()
    // No icon and no window showing: Cancel brings the main window back.
    h.iconAvailable.value = false
    vi.mocked(queueManager.generatingCount).mockReturnValue(2)
    const quit = beforeQuit()
    await until(() => expect(showQuitFailure).toHaveBeenCalledOnce())
    expect(quit.preventDefault).toHaveBeenCalledOnce()
    const [question, , , owner] = vi.mocked(showQuitFailure).mock.calls[0]!
    expect(question).toEqual({ kind: 'confirm', work: { generating: 2, elaborating: false, tools: false, drafts: [] }, platform: process.platform })
    // The controller stand-in has no window; the question stands alone.
    expect(owner).toBeUndefined()
    await until(() => expect(h.controllers[0]!.restoreOrCreate).toHaveBeenCalled())
    expect(h.controllers[0]!.beginShutdown).not.toHaveBeenCalled()
    expect(h.app.exit).not.toHaveBeenCalled()
  })

  it('asks before stopping elaboration alone and preserves it on Cancel', async () => {
    await launch()
    vi.mocked(hasActiveBrainstorms).mockReturnValue(true)
    beforeQuit()
    await until(() => expect(showQuitFailure).toHaveBeenCalledOnce())
    expect(vi.mocked(showQuitFailure).mock.calls[0]![0]).toMatchObject({
      kind: 'confirm', work: { generating: 0, elaborating: true, tools: false, drafts: [] },
    })
    expect(cancelAllBrainstorms).not.toHaveBeenCalled()
    expect(h.controllers[0]!.beginShutdown).not.toHaveBeenCalled()
    expect(h.app.exit).not.toHaveBeenCalled()
  })

  it('OS takeover stops elaboration without requesting confirmation', async () => {
    await launch()
    vi.mocked(hasActiveBrainstorms).mockReturnValue(true)
    h.emit(h.powerListeners, 'shutdown')
    await until(() => expect(forceExit).toHaveBeenCalledOnce())
    expect(cancelAllBrainstorms).toHaveBeenCalledOnce()
    expect(showQuitFailure).not.toHaveBeenCalled()
  })

  it('quits once the user confirms', async () => {
    await launch()
    vi.mocked(queueManager.generatingCount).mockReturnValue(1)
    vi.mocked(showQuitFailure).mockImplementation(async () => 'quit')
    beforeQuit()
    await until(() => expect(h.app.exit).toHaveBeenCalledExactlyOnceWith(0))
    expect(h.controllers[0]!.beginShutdown).toHaveBeenCalledOnce()
  })

  it('a cancelled quit with the icon showing leaves the app where it was', async () => {
    await launch()
    vi.mocked(queueManager.generatingCount).mockReturnValue(1)
    beforeQuit()
    await until(() => expect(showQuitFailure).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.controllers[0]!.restoreOrCreate).not.toHaveBeenCalled()
  })

  // Background mode (window-conventions): every window goes and returns with main.
  it('hides Records and the preview with the main window and returns them with it', async () => {
    await launch()
    const options = h.controllers[0]!.options as { onHiddenToBackground: () => void; onRestored: () => void }
    options.onHiddenToBackground()
    expect(hideRecordsWindow).toHaveBeenCalledOnce()
    expect(hidePreviewWindow).toHaveBeenCalledOnce()
    options.onRestored()
    expect(showRecordsWindow).toHaveBeenCalledOnce()
    expect(showPreviewWindow).toHaveBeenCalledOnce()
  })

  it('closing the main window without an icon quits through the quit flow on every platform', async () => {
    await launch()
    ;(h.controllers[0]!.options['requestQuit'] as () => void)()
    expect(h.app.quit).toHaveBeenCalledOnce()
    h.iconAvailable.value = false
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
    try {
      ;(h.controllers[0]!.options['onPrimaryWindowClosed'] as () => void)()
    } finally {
      Object.defineProperty(process, 'platform', platform)
    }
    expect(h.app.quit).toHaveBeenCalledTimes(2)
  })

  it('opens Settings from the app menu in the main window, brought forward first', async () => {
    const { buildAppMenuTemplate } = await import('../../src/main/app-menu')
    await launch()
    const send = vi.fn()
    h.mainWindow.value = { isDestroyed: () => false, webContents: { send } }
    const state = vi.mocked(buildAppMenuTemplate).mock.calls.at(-1)![2]!
    expect(state.dialogOpen).toBe(false)
    state.openSettings()
    expect(h.controllers[0]!.restoreOrCreate).toHaveBeenCalledOnce()
    await until(() => expect(send).toHaveBeenCalledWith('window:command', 'settings'))
  })

  // About and Settings wait while a dialog is in front (app-chrome-conventions).
  it('disables About and Settings while the main window reports a dialog, and only the main window may report', async () => {
    const { buildAppMenuTemplate } = await import('../../src/main/app-menu')
    await launch()
    const page = { send: vi.fn() }
    h.mainWindow.value = { isDestroyed: () => false, webContents: page as never }
    const report = vi.mocked(handle).mock.calls.find(([channel]) => channel === 'menu:dialogOpen')![1] as (event: { sender: unknown }, open: unknown) => void
    const builds = () => vi.mocked(buildAppMenuTemplate).mock.calls.length
    const lastState = () => vi.mocked(buildAppMenuTemplate).mock.calls.at(-1)![2]!
    const before = builds()
    report({ sender: {} }, true)
    report({ sender: page }, 'yes')
    expect(builds()).toBe(before)
    report({ sender: page }, true)
    expect(lastState().dialogOpen).toBe(true)
    report({ sender: page }, true)
    expect(builds()).toBe(before + 1)
    report({ sender: page }, false)
    expect(lastState().dialogOpen).toBe(false)
  })
})



it('reloads a gone primary view on the next restore without restarting work', async () => {
  await launch()
  const { createWindowWithUsablePersistedBounds } = await import('../../src/main/window-state-recovery')
  const { loadMainWindowContent } = await import('../../src/main/main-window-content')
  const { processQueues } = await import('../../src/main/backends')
  const webContents = Object.assign(new EventEmitter(), { send: vi.fn() })
  const win = Object.assign(new EventEmitter(), {
    webContents, isDestroyed: () => false, isVisible: () => true,
    isMinimized: () => false,
  }) as unknown as Electron.BrowserWindow
  vi.mocked(createWindowWithUsablePersistedBounds).mockReturnValueOnce(win)
  const options = h.controllers[0]!.options
  expect((options.createWindow as () => Electron.BrowserWindow)()).toBe(win)
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(loadMainWindowContent).toHaveBeenCalledOnce()
  webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 7 })
  expect(loadMainWindowContent).toHaveBeenCalledOnce()
  const restore = options.prepareWindow as (win: Electron.BrowserWindow) => Promise<boolean>
  await expect(restore(win)).resolves.toBe(true)
  expect(loadMainWindowContent).toHaveBeenCalledTimes(2)
  expect(processQueues).toHaveBeenCalledOnce()
  expect(session.initSession).toHaveBeenCalledOnce()
  expect(createStartupFailureWindow).not.toHaveBeenCalled()
  expect(h.app.exit).not.toHaveBeenCalled()
})

// A failure surface opened during exit loads into the same teardown and falls
// back to a native modal alert, which blocks the exit and later quit requests.
it('a quit during the first page load exits without presenting a startup failure', async () => {
  const { createWindowWithUsablePersistedBounds } = await import('../../src/main/window-state-recovery')
  const { loadMainWindowContent } = await import('../../src/main/main-window-content')
  let failLoad!: (error: Error) => void
  vi.mocked(loadMainWindowContent).mockReturnValueOnce(new Promise<void>((_, reject) => { failLoad = reject }))
  const webContents = Object.assign(new EventEmitter(), { send: vi.fn() })
  const win = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false })
  vi.mocked(createWindowWithUsablePersistedBounds).mockReturnValueOnce(win as unknown as Electron.BrowserWindow)
  h.createPrimary.value = true
  await launch()
  beforeQuit()
  await until(() => expect(h.app.exit).toHaveBeenCalledExactlyOnceWith(0))
  // Exiting destroys the window while its page is still loading.
  failLoad(new Error("ERR_FAILED (-2) loading 'index.html'"))
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(createStartupFailureWindow).not.toHaveBeenCalled()
})


