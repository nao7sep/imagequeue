import { beforeEach, describe, expect, it, vi } from 'vitest'

// The main entry is driven through a stand-in Electron whose single-instance
// lock answer the test chooses.
const electron = vi.hoisted(() => ({
  app: {
    requestSingleInstanceLock: vi.fn((): boolean => false),
    exit: vi.fn((_code: number): void => {}),
    quit: vi.fn((): void => {}),
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

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
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
    expect(primary.loaded).not.toHaveBeenCalled()
    expect(primary.runPrimaryInstance).not.toHaveBeenCalled()
  })

  it('loads and starts the app only after a process has the lock', async () => {
    electron.app.requestSingleInstanceLock.mockReturnValue(true)

    const { startup } = await import('../../src/main/index')
    await startup

    expect(primary.loaded).toHaveBeenCalledOnce()
    expect(primary.runPrimaryInstance).toHaveBeenCalledOnce()
    expect(electron.app.requestSingleInstanceLock.mock.invocationCallOrder[0])
      .toBeLessThan(primary.runPrimaryInstance.mock.invocationCallOrder[0])
    expect(electron.app.exit).not.toHaveBeenCalled()
    expect(electron.app.quit).not.toHaveBeenCalled()
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
