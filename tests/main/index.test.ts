import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The main entry is driven through a stand-in Electron whose single-instance
// lock answer the test chooses.
const electron = vi.hoisted(() => ({
  app: {
    requestSingleInstanceLock: vi.fn((): boolean => false),
    exit: vi.fn((_code: number): void => {}),
    quit: vi.fn((): void => {}),
    setPath: vi.fn((_name: string, _path: string): void => {}),
    setAppLogsPath: vi.fn((_path: string): void => {}),
  },
  dialog: { showErrorBox: vi.fn((_title: string, _content: string): void => {}) },
}))
vi.mock('electron', () => electron)

// The app body the entry loads once it holds the lock. Standing in for it keeps
// these tests to the lock decision itself: loading the real body would compile
// and evaluate the whole main process inside each test.
const primary = vi.hoisted(() => ({ loaded: vi.fn(), runPrimaryInstance: vi.fn() }))
vi.mock('../../src/main/primary-instance', () => {
  primary.loaded()
  return { runPrimaryInstance: primary.runPrimaryInstance }
})

let temporary: string
let root: string

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-entry-'))
  root = path.join(temporary, 'isolated-root')
  vi.stubEnv('IMAGEQUEUE_DATA_DIR', root)
})

afterEach(() => {
  vi.unstubAllEnvs()
  fs.rmSync(temporary, { recursive: true, force: true })
})

describe('main entry and the single-instance lock', () => {
  it('exits a process that lost the lock without loading or starting anything of the app', async () => {
    electron.app.requestSingleInstanceLock.mockReturnValue(false)

    const { startup } = await import('../../src/main/index')
    await startup

    expect(electron.app.requestSingleInstanceLock).toHaveBeenCalledOnce()
    expect(electron.app.exit).toHaveBeenCalledExactlyOnceWith(0)
    // A quit would run the before-quit shutdown against the running instance's stores.
    expect(electron.app.quit).not.toHaveBeenCalled()
    expect(fs.existsSync(root)).toBe(false)
    expect(electron.app.setPath).not.toHaveBeenCalled()
    expect(electron.app.setAppLogsPath).not.toHaveBeenCalled()
    expect(primary.loaded).not.toHaveBeenCalled()
    expect(primary.runPrimaryInstance).not.toHaveBeenCalled()
  })

  it('loads and starts the app only after a process has the lock', async () => {
    electron.app.requestSingleInstanceLock.mockReturnValue(true)

    const { startup } = await import('../../src/main/index')
    await startup

    const profile = path.join(root, 'electron')
    expect(fs.statSync(profile).isDirectory()).toBe(true)
    expect(electron.app.setPath.mock.calls).toEqual([['userData', profile], ['sessionData', profile]])
    expect(electron.app.setAppLogsPath).toHaveBeenCalledExactlyOnceWith(path.join(profile, 'logs'))
    const lockOrder = electron.app.requestSingleInstanceLock.mock.invocationCallOrder[0]
    const loadedOrder = primary.loaded.mock.invocationCallOrder[0]
    for (const configuredOrder of [...electron.app.setPath.mock.invocationCallOrder, ...electron.app.setAppLogsPath.mock.invocationCallOrder]) {
      expect(lockOrder).toBeLessThan(configuredOrder)
      expect(configuredOrder).toBeLessThan(loadedOrder)
    }
    expect(primary.loaded).toHaveBeenCalledOnce()
    expect(primary.runPrimaryInstance).toHaveBeenCalledOnce()
    expect(electron.app.requestSingleInstanceLock.mock.invocationCallOrder[0])
      .toBeLessThan(primary.runPrimaryInstance.mock.invocationCallOrder[0])
    expect(electron.app.exit).not.toHaveBeenCalled()
    expect(electron.app.quit).not.toHaveBeenCalled()
  })

  it('reports an unusable isolated root before importing the primary app', async () => {
    electron.app.requestSingleInstanceLock.mockReturnValue(true)
    fs.writeFileSync(root, 'occupied')
    const { startup } = await import('../../src/main/index')
    await startup
    expect(electron.dialog.showErrorBox).toHaveBeenCalledExactlyOnceWith('ImageQueue', expect.stringContaining(root))
    expect(electron.app.exit).toHaveBeenCalledExactlyOnceWith(1)
    expect(primary.loaded).not.toHaveBeenCalled()
    expect(electron.app.setPath).not.toHaveBeenCalled()
    expect(electron.app.setAppLogsPath).not.toHaveBeenCalled()
    expect(fs.readFileSync(root, 'utf8')).toBe('occupied')
  })

  it('shows the load failure and exits when the app cannot be started', async () => {
    electron.app.requestSingleInstanceLock.mockReturnValue(true)
    primary.runPrimaryInstance.mockImplementationOnce(() => { throw new Error('broken build') })

    const { startup } = await import('../../src/main/index')
    await startup

    expect(electron.dialog.showErrorBox).toHaveBeenCalledExactlyOnceWith('ImageQueue', expect.stringContaining('broken build'))
    expect(electron.app.exit).toHaveBeenCalledExactlyOnceWith(1)
  })
})
