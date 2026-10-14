import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  const controllers: Array<{ options: Record<string, unknown>; markStartupComplete: ReturnType<typeof vi.fn>; beginShutdown: ReturnType<typeof vi.fn> }> = []
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
    emit(map: Map<string, Listener[]>, event: string, ...args: unknown[]): void {
      for (const listener of map.get(event) ?? []) listener(...args)
    },
  }
})

vi.mock('electron', () => ({
  app: h.app,
  powerMonitor: h.powerMonitor,
  BrowserWindow: vi.fn(),
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
}))
vi.mock('../../src/main/utils/storage-wait', () => ({ drainExports: vi.fn(async () => undefined) }))
vi.mock('../../src/main/config', () => ({
  loadConfig: vi.fn(() => ({ general: { theme: 'system', show_status_icon: false, show_preview_window: false } })),
  ensureDataDir: vi.fn(),
  getDataDir: vi.fn(() => '/data'),
  summarizeConfig: vi.fn(),
}))
vi.mock('../../src/main/session', () => ({
  dropCurrentSessionIfEmpty: vi.fn(async () => undefined),
  initSession: vi.fn(async () => undefined),
  getSessionDir: vi.fn(() => '/data/sessions/s'),
  persistActiveSession: vi.fn(async () => undefined),
  drainSessionWrites: vi.fn(async () => undefined),
  registerSessionIpc: vi.fn(),
  resetOutputTimestampAllocators: vi.fn(),
}))
vi.mock('../../src/main/queue', () => ({ registerQueueIpc: vi.fn() }))
vi.mock('../../src/main/backends', () => ({ startProcessor: vi.fn(), stopProcessor: vi.fn() }))
vi.mock('../../src/main/image-protocol', () => ({ registerImageProtocol: vi.fn(), registerImageSchemeAsPrivileged: vi.fn() }))
vi.mock('../../src/main/settings-ipc', () => ({ registerSettingsIpc: vi.fn() }))
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
vi.mock('../../src/main/viewing-ipc', () => ({ registerViewingIpc: vi.fn() }))
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
vi.mock('../../src/main/records-reader', () => ({ closeRecordsReader: vi.fn(async () => undefined) }))
vi.mock('../../src/main/records-window', () => ({ closeRecordsWindow: vi.fn(), notifyRecordsChanged: vi.fn() }))
vi.mock('../../src/main/cli-jobs', () => ({ killAllCliJobsAndWait: vi.fn(async () => ({ signalled: 0, settled: true })) }))
vi.mock('../../src/main/backends/cancellation', () => ({
  cancelAllInFlightAndWait: vi.fn(async () => ({ settled: true })),
  resumeAfterCancelledShutdown: vi.fn(),
}))
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
vi.mock('../../src/main/quit-failure-window', () => ({ showQuitFailure: vi.fn(async () => 'cancel') }))
vi.mock('../../src/main/backend-defaults', () => ({ drainBackendDefaults: vi.fn(async () => undefined) }))
vi.mock('../../src/main/settings-writes', () => ({ retrySettingsWrites: vi.fn(async () => undefined) }))
vi.mock('../../src/main/brainstorm', () => ({ cancelAllBrainstorms: vi.fn(), hasActiveBrainstorms: vi.fn(() => false) }))
vi.mock('../../src/main/dependencies/operations', () => ({
  cancelAllDependencyOperations: vi.fn(), hasActiveDependencyOperations: vi.fn(() => false),
}))
vi.mock('../../src/main/app-release-check', () => ({ startAppReleaseCheck: vi.fn() }))
vi.mock('../../src/main/last-resort-hooks', () => ({ installLastResortHooks: vi.fn() }))
vi.mock('../../src/main/failure-presentation', () => ({ startupFailurePresentation: vi.fn(() => ({ key: 'startup' })) }))
vi.mock('../../src/main/main-window-lifecycle', () => ({
  MainWindowController: vi.fn(function (this: Record<string, unknown>, options: Record<string, unknown>) {
    const controller = {
      options,
      markStartupComplete: vi.fn(),
      createInitialWindow: vi.fn(),
      beginShutdown: vi.fn(),
      cancelShutdown: vi.fn(),
      dispose: vi.fn(),
      getWindow: vi.fn(() => null),
      restoreOrCreate: vi.fn(async () => undefined),
      retainActivationSurface: vi.fn(async () => undefined),
    }
    h.controllers.push(controller)
    return controller
  }),
}))
vi.mock('../../src/main/status-icon', () => ({
  StatusIconController: vi.fn(function () { return { reconcile: vi.fn(async () => undefined), dispose: vi.fn() } }),
}))
vi.mock('../../src/main/session/open-sessions-folder', () => ({ openSessionsFolder: vi.fn() }))
vi.mock('../../src/main/queue/control-actions', () => ({ setQueuePausedAndPublish: vi.fn() }))
vi.mock('../../src/main/main-window-content', () => ({ ownMainWindowContentLoad: vi.fn() }))
vi.mock('../../src/main/i18n', () => ({
  applyLocalePreferences: vi.fn(async () => undefined),
  mainTranslator: vi.fn(() => ({ t: (key: string) => key })),
  onLanguageChanged: vi.fn(),
  registerLanguageIpc: vi.fn(),
  settleLanguage: vi.fn(async () => undefined),
}))
vi.mock('../../src/main/app-menu', () => ({ buildAppMenuTemplate: vi.fn(() => []), buildTextContextMenuTemplate: vi.fn() }))

const session = await import('../../src/main/session')
const records = await import('../../src/main/records')
const { showQuitFailure } = await import('../../src/main/quit-failure-window')
const { forceExit } = await import('../../src/main/utils/force-exit')
const { createStartupFailureWindow } = await import('../../src/main/startup-failure-window')

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  h.appListeners.clear()
  h.powerListeners.clear()
  h.controllers.length = 0
  h.startUpFails.value = false
  vi.mocked(session.persistActiveSession).mockResolvedValue(undefined as never)
})

async function launch(): Promise<void> {
  const { runPrimaryInstance } = await import('../../src/main/primary-instance')
  runPrimaryInstance()
  if (h.startUpFails.value) await vi.waitFor(() => expect(createStartupFailureWindow).toHaveBeenCalledOnce())
  else await vi.waitFor(() => expect(h.controllers[0]?.markStartupComplete).toHaveBeenCalledOnce())
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

    await vi.waitFor(() => expect(forceExit).toHaveBeenCalledOnce())
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

    await vi.waitFor(() => expect(forceExit).toHaveBeenCalledOnce())
    expect(showQuitFailure).not.toHaveBeenCalled()
  })

  it('Windows logoff reaches the same takeover through the main window', async () => {
    await launch()
    const onSessionEnd = h.controllers[0]!.options['onSessionEnd'] as () => void
    expect(onSessionEnd).toBe(h.powerListeners.get('shutdown')![0])
    onSessionEnd()

    await vi.waitFor(() => expect(forceExit).toHaveBeenCalledOnce())
    expect(session.persistActiveSession).toHaveBeenCalledTimes(2)
    expect(showQuitFailure).not.toHaveBeenCalled()
  })

  it('ordinary quit saves, disposes and exits cleanly', async () => {
    await launch()
    const quit = beforeQuit()

    await vi.waitFor(() => expect(h.app.exit).toHaveBeenCalledExactlyOnceWith(0))
    expect(quit.preventDefault).toHaveBeenCalledOnce()
    expect(session.persistActiveSession).toHaveBeenCalledTimes(2)
    expect(records.closeRecords).toHaveBeenCalledOnce()
    expect(forceExit).not.toHaveBeenCalled()
  })

  it('quitting after a failed startup does not report a save failure', async () => {
    h.startUpFails.value = true
    await launch()
    beforeQuit()

    await vi.waitFor(() => expect(h.app.exit).toHaveBeenCalledExactlyOnceWith(0))
    expect(showQuitFailure).not.toHaveBeenCalled()
    expect(session.persistActiveSession).not.toHaveBeenCalled()
  })

  it.each([['win32', 1], ['linux', 1], ['darwin', 0]] as const)('closing the primary window on %s requests quit %i times', async (value, quits) => {
    await launch()
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { configurable: true, value })
    try {
      ;(h.controllers[0]!.options['onPrimaryWindowClosed'] as () => void)()
    } finally {
      Object.defineProperty(process, 'platform', platform)
    }
    expect(h.app.quit).toHaveBeenCalledTimes(quits)
  })
})
