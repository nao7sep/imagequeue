import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DependenciesState } from '../../src/shared/types'

type Handler = (event: { sender: FakeSender }, ...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  checkAllDependencies: vi.fn(),
  installOrUpdateCli: vi.fn(),
  downloadLatestRecommendations: vi.fn(),
  applyPendingRecommendations: vi.fn(),
}))

vi.mock('../../src/main/ipc-boundary', () => ({
  handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
}))

vi.mock('../../src/main/config', () => ({
  loadConfig: () => ({ image_backends: { drawthings: { check_updates_at_launch: true } } }),
  saveConfig: vi.fn(),
}))

const state: DependenciesState = {
  cli: {
    id: 'cli',
    state: 'not-installed',
    installedLabel: null,
    latestLabel: null,
    updatedAtUtc: null,
    lastCheckedAtUtc: null,
  },
  recommendations: {
    id: 'recommendations',
    state: 'not-installed',
    installedLabel: null,
    latestLabel: null,
    updatedAtUtc: null,
    lastCheckedAtUtc: null,
  },
  checkUpdatesAtLaunch: true,
  platformSupported: true,
}

vi.mock('../../src/main/dependencies/service', () => ({
  getDependenciesState: () => state,
  checkAllDependencies: mocks.checkAllDependencies,
  installOrUpdateCli: mocks.installOrUpdateCli,
}))

vi.mock('../../src/main/recommendations', () => ({
  downloadLatestRecommendations: mocks.downloadLatestRecommendations,
  applyPendingRecommendations: mocks.applyPendingRecommendations,
}))

class FakeSender extends EventEmitter {
  readonly id: number
  readonly send = vi.fn()
  private destroyed = false

  constructor(id: number) {
    super()
    this.id = id
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  destroy(): void {
    this.destroyed = true
    this.emit('destroyed')
  }
}

interface DeferredOperation {
  promise: Promise<void>
  resolve: () => void
  reject: (reason?: unknown) => void
  signal: AbortSignal
}

function deferredOperation(signal: AbortSignal, rejectOnAbort = true): DeferredOperation {
  let resolve!: () => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  const abort = (): void => {
    if (rejectOnAbort) reject(signal.reason)
  }
  signal.addEventListener('abort', abort, { once: true })
  void promise.finally(() => signal.removeEventListener('abort', abort)).catch(() => undefined)
  return { promise, resolve, reject, signal }
}

const { registerDependenciesIpc } = await import('../../src/main/dependencies-ipc')
registerDependenciesIpc()

function invoke(channel: string, sender: FakeSender, ...args: unknown[]): Promise<unknown> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return Promise.resolve(handler({ sender }, ...args))
}

beforeEach(() => {
  mocks.checkAllDependencies.mockReset()
  mocks.installOrUpdateCli.mockReset()
  mocks.downloadLatestRecommendations.mockReset()
  mocks.applyPendingRecommendations.mockReset()
})

describe('dependency IPC operation ownership', () => {
  it('aborts on owner destruction but retains ownership until settlement', async () => {
    const owner = new FakeSender(1)
    const replacement = new FakeSender(2)
    let active!: DeferredOperation
    mocks.installOrUpdateCli.mockImplementation((_progress, signal: AbortSignal) => {
      active = deferredOperation(signal, false)
      return active.promise
    })

    const install = invoke('dependencies:installCli', owner)
    expect(owner.listenerCount('destroyed')).toBe(1)

    owner.destroy()

    expect(active.signal.aborted).toBe(true)
    await expect(invoke('dependencies:installCli', replacement)).rejects.toThrow(
      'Dependency cli operation is already running'
    )

    active.reject(active.signal.reason)
    await expect(install).rejects.toThrow('window closed')
    expect(owner.listenerCount('destroyed')).toBe(0)
  })

  it('refuses a duplicate from another window until the owner settles, then permits retry', async () => {
    const owner = new FakeSender(1)
    const replacement = new FakeSender(2)
    let active!: DeferredOperation
    mocks.installOrUpdateCli.mockImplementationOnce((_progress, signal: AbortSignal) => {
      active = deferredOperation(signal)
      return active.promise
    })

    const firstInstall = invoke('dependencies:installCli', owner)
    await expect(invoke('dependencies:installCli', replacement)).rejects.toThrow(
      'Dependency cli operation is already running'
    )

    await invoke('dependencies:cancelOperations', owner)
    await expect(firstInstall).rejects.toThrow('Dependency operation cancelled')

    mocks.installOrUpdateCli.mockResolvedValueOnce(state)
    await expect(invoke('dependencies:installCli', replacement)).resolves.toBe(state)
    expect(mocks.installOrUpdateCli).toHaveBeenCalledTimes(2)
  })

  it('allows CLI and recommendations operations to run concurrently', async () => {
    const cliOwner = new FakeSender(1)
    const recommendationsOwner = new FakeSender(2)
    let cli!: DeferredOperation
    let recommendations!: DeferredOperation
    mocks.installOrUpdateCli.mockImplementation((_progress, signal: AbortSignal) => {
      cli = deferredOperation(signal)
      return cli.promise.then(() => state)
    })
    mocks.downloadLatestRecommendations.mockImplementation((signal: AbortSignal) => {
      recommendations = deferredOperation(signal)
      return recommendations.promise
    })

    const cliInstall = invoke('dependencies:installCli', cliOwner)
    const recommendationsDownload = invoke(
      'dependencies:downloadRecommendations',
      recommendationsOwner
    )

    expect(cli.signal.aborted).toBe(false)
    expect(recommendations.signal.aborted).toBe(false)
    cli.resolve()
    recommendations.resolve()

    await expect(cliInstall).resolves.toBe(state)
    await expect(recommendationsDownload).resolves.toBe(state)
  })

  it('reserves both dependencies while a set-wide check is running', async () => {
    const checkOwner = new FakeSender(1)
    const otherWindow = new FakeSender(2)
    let check!: DeferredOperation
    mocks.checkAllDependencies.mockImplementation((signal: AbortSignal) => {
      check = deferredOperation(signal)
      return check.promise.then(() => state)
    })

    const checking = invoke('dependencies:check', checkOwner)

    await expect(invoke('dependencies:installCli', otherWindow)).rejects.toThrow(
      'Dependency cli operation is already running'
    )
    await expect(
      invoke('dependencies:downloadRecommendations', otherWindow)
    ).rejects.toThrow('Dependency recommendations operation is already running')

    check.resolve()
    await expect(checking).resolves.toBe(state)
  })
})
