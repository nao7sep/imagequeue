import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  exclusive: vi.fn(), stopCurrent: vi.fn(), stopIfOwner: vi.fn(), start: vi.fn(),
  validatePackage: vi.fn(), buildPackage: vi.fn(), assertEndpointAvailable: vi.fn(), spawn: vi.fn(), stat: vi.fn(),
}))
vi.mock('../../scripts/launcher-runtime.mjs', () => ({
  LauncherRuntime: class { exclusive = mocks.exclusive; stopCurrent = mocks.stopCurrent; stopIfOwner = mocks.stopIfOwner; start = mocks.start },
  REPO_ROOT: '/fixture', RENDERER_HOST: '127.0.0.1', RENDERER_PORT: 20641, assertEndpointAvailable: mocks.assertEndpointAvailable,
}))
vi.mock('../../scripts/launcher-build.mjs', () => ({ validatePackage: mocks.validatePackage, buildPackage: mocks.buildPackage }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('node:fs/promises', () => ({ stat: mocks.stat }))
// @ts-expect-error Directly executed ESM helper.
import { launch } from '../../scripts/launcher.mjs'
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
beforeEach(() => {
  vi.resetAllMocks()
  Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  mocks.exclusive.mockImplementation(async (operation: () => Promise<void>) => operation())
  mocks.stat.mockResolvedValue({ mtime: new Date('2026-01-01T00:00:00Z') })
  mocks.validatePackage.mockResolvedValue('/fixture/dist/app')
  mocks.start.mockResolvedValue({ token: 'current', exited: Promise.resolve(0) })
  mocks.stopIfOwner.mockResolvedValue(undefined)
  mocks.spawn.mockImplementation(() => { const child = new EventEmitter(); queueMicrotask(() => child.emit('exit', 0)); return child })
})
afterEach(() => { Object.defineProperty(process, 'platform', platform); vi.restoreAllMocks() })

describe('paired launcher orchestration', () => {
  it('never installs, rebuilds or starts after refused ordinary closure', async () => {
    mocks.stopCurrent.mockRejectedValue(new Error('Quit declined'))
    await expect(launch('rebuild')).rejects.toThrow('Quit declined')
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.buildPackage).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
  })
  it('leaves the current app alone when run-built has no complete package', async () => {
    mocks.validatePackage.mockRejectedValue(new Error('missing app'))
    await expect(launch('run-built')).rejects.toThrow('Run rebuild first')
    expect(mocks.stopCurrent).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
  })
  it('runs an existing build without installing or rebuilding', async () => {
    await launch('run-built')
    expect(mocks.stopCurrent).toHaveBeenCalledOnce()
    expect(mocks.start).toHaveBeenCalledWith('/fixture/dist/app', [])
    expect(mocks.stat).toHaveBeenCalledWith('/fixture/dist')
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.buildPackage).not.toHaveBeenCalled()
  })
  it('an interrupt during replacement prevents later install or launch and releases listeners', async () => {
    const before = process.listenerCount('SIGINT')
    mocks.stopCurrent.mockImplementation(async () => { process.emit('SIGINT') })
    await expect(launch('run-dev')).rejects.toMatchObject({ message: 'Launcher interrupted before app startup.', exitCode: 130 })
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
    expect(process.listenerCount('SIGINT')).toBe(before)
  })
  it('an interrupt during startup waits for readiness then requests that generation’s normal Quit', async () => {
    mocks.start.mockImplementation(async () => { process.emit('SIGINT'); return { token: 'new-generation', exited: Promise.resolve(0) } })
    await launch('run-dev')
    expect(mocks.stopIfOwner).toHaveBeenCalledWith('new-generation')
    expect(mocks.assertEndpointAvailable).toHaveBeenCalledOnce()
    expect(mocks.start).toHaveBeenCalledWith(process.execPath, ['/fixture/node_modules/electron-vite/bin/electron-vite.js', 'dev'], { development: true })
  })
})
