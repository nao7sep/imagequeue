import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The main entry is driven through a stand-in Electron whose single-instance
// lock answer the test chooses; nothing else of Electron is reached at import.
const electron = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    requestSingleInstanceLock: (): boolean => false,
    exit: (_code: number): void => {},
    quit: (): void => {},
    on: (_event: string, _listener: unknown): void => {},
    whenReady: (): Promise<void> => new Promise<void>(() => {}),
  },
  protocol: { registerSchemesAsPrivileged: (_schemes: unknown): void => {} },
}))

vi.mock('electron', () => ({
  ...electron,
  BrowserWindow: class {},
  Menu: {},
  ipcMain: {},
  nativeTheme: {},
  screen: {},
  session: {},
  shell: {},
}))

// The bundler's worker factories; a worker started here would be work begun.
const workers = vi.hoisted(() => ({ archive: vi.fn(), recordsReader: vi.fn() }))
vi.mock('../../src/main/backup/archive-worker?nodeWorker', () => ({ default: workers.archive }))
vi.mock('../../src/main/records-reader-worker?nodeWorker', () => ({ default: workers.recordsReader }))

const PROCESS_HOOKS = ['uncaughtException', 'unhandledRejection'] as const

let dataDir: string
let savedDataDir: string | undefined
let hooksBefore: Map<string, Function[]>

beforeEach(() => {
  vi.resetModules()
  dataDir = mkdtempSync(path.join(tmpdir(), 'imagequeue-index-'))
  savedDataDir = process.env.IMAGEQUEUE_DATA_DIR
  process.env.IMAGEQUEUE_DATA_DIR = dataDir
  hooksBefore = new Map(PROCESS_HOOKS.map((event) => [event, process.listeners(event)]))
})

afterEach(() => {
  vi.restoreAllMocks()
  // Remove the last-resort hooks a primary-instance import installs on this worker.
  for (const event of PROCESS_HOOKS) {
    const before = hooksBefore.get(event) ?? []
    for (const listener of process.listeners(event)) {
      if (!before.includes(listener)) process.removeListener(event, listener as (...args: unknown[]) => void)
    }
  }
  if (savedDataDir === undefined) delete process.env.IMAGEQUEUE_DATA_DIR
  else process.env.IMAGEQUEUE_DATA_DIR = savedDataDir
  rmSync(dataDir, { recursive: true, force: true })
})

function spyOnElectron(ownsLock: boolean) {
  return {
    requestLock: vi.spyOn(electron.app, 'requestSingleInstanceLock').mockReturnValue(ownsLock),
    exit: vi.spyOn(electron.app, 'exit'),
    quit: vi.spyOn(electron.app, 'quit'),
    on: vi.spyOn(electron.app, 'on'),
    whenReady: vi.spyOn(electron.app, 'whenReady'),
    registerSchemes: vi.spyOn(electron.protocol, 'registerSchemesAsPrivileged'),
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('main entry and the single-instance lock', () => {
  it('exits a process that lost the lock without registering, opening or writing anything', async () => {
    const spies = spyOnElectron(false)

    await import('../../src/main/index')
    await settle()

    expect(spies.requestLock).toHaveBeenCalledOnce()
    expect(spies.exit).toHaveBeenCalledExactlyOnceWith(0)
    // A quit would run the before-quit shutdown against the running instance's stores.
    expect(spies.quit).not.toHaveBeenCalled()
    expect(spies.on).not.toHaveBeenCalled()
    expect(spies.whenReady).not.toHaveBeenCalled()
    expect(spies.registerSchemes).not.toHaveBeenCalled()
    for (const event of PROCESS_HOOKS) expect(process.listeners(event)).toEqual(hooksBefore.get(event))
    expect(workers.archive).not.toHaveBeenCalled()
    expect(workers.recordsReader).not.toHaveBeenCalled()
    expect(readdirSync(dataDir)).toEqual([])
  })

  it('decides the lock before a process that owns it registers its quit handling and startup', async () => {
    const spies = spyOnElectron(true)

    await import('../../src/main/index')
    await settle()

    const events = spies.on.mock.calls.map(([event]) => event)
    expect(events).toEqual(expect.arrayContaining(['second-instance', 'window-all-closed', 'before-quit']))
    expect(spies.requestLock.mock.invocationCallOrder[0]).toBeLessThan(Math.min(
      ...spies.on.mock.invocationCallOrder,
      ...spies.whenReady.mock.invocationCallOrder,
      ...spies.registerSchemes.mock.invocationCallOrder,
    ))
    expect(spies.exit).not.toHaveBeenCalled()
    expect(spies.quit).not.toHaveBeenCalled()
    // Startup waits for ready, which this stand-in never reaches, so nothing is opened yet.
    expect(readdirSync(dataDir)).toEqual([])
  })
})
