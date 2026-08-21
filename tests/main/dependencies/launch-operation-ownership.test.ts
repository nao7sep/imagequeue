import { EventEmitter } from 'node:events'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type Handler = (event: { sender: FakeSender }, ...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  home: '',
  resolveLatestCliRelease: vi.fn(),
  checkRecommendations: vi.fn(),
  downloadLatestRecommendations: vi.fn(),
  applyPendingRecommendations: vi.fn(),
}))

vi.mock('../../../src/main/ipc-boundary', () => ({
  handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
}))

vi.mock('../../../src/main/config', () => ({
  getDataDir: () => mocks.home,
  loadConfig: () => ({
    image_backends: {
      drawthings: {
        check_updates_at_launch: true,
      },
    },
  }),
  saveConfig: vi.fn(),
}))

vi.mock('../../../src/main/dependencies/cli-release', () => ({
  resolveLatestCliRelease: mocks.resolveLatestCliRelease,
}))

vi.mock('../../../src/main/recommendations', () => ({
  checkRecommendations: mocks.checkRecommendations,
  downloadLatestRecommendations: mocks.downloadLatestRecommendations,
  applyPendingRecommendations: mocks.applyPendingRecommendations,
  getRecommendationsStatus: () => ({
    exists: false,
    valid: false,
    entryCount: 0,
    updatedAt: null,
  }),
  hasPendingRecommendationsUpdate: () => false,
}))

class FakeSender extends EventEmitter {
  readonly send = vi.fn()

  isDestroyed(): boolean {
    return false
  }
}

const { checkDependenciesAtLaunch } = await import('../../../src/main/dependencies/service')
const { registerDependenciesIpc } = await import('../../../src/main/dependencies-ipc')
registerDependenciesIpc()

function invoke(channel: string, sender: FakeSender): Promise<unknown> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return Promise.resolve(handler({ sender }))
}

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

beforeAll(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
})

afterAll(() => {
  if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
})

beforeEach(() => {
  mocks.home = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-launch-ownership-'))
  mocks.resolveLatestCliRelease.mockReset()
  mocks.resolveLatestCliRelease.mockResolvedValue({
    tag: 'v1.20260822.0',
    assetUrl: 'https://example.com/draw-things-cli',
    sha256: 'abc',
  })
  mocks.checkRecommendations.mockReset()
  mocks.downloadLatestRecommendations.mockReset()
  mocks.applyPendingRecommendations.mockReset()
})

afterEach(() => {
  fs.rmSync(mocks.home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

describe('launch and manual dependency operation ownership', () => {
  it('orders an explicit config download after a launch check before replacing its pending result', async () => {
    const events: string[] = []
    let finishLaunchCheck!: () => void
    let pendingConfig: string | null = null
    let installedConfig: string | null = null

    mocks.checkRecommendations.mockImplementation(
      () => new Promise<void>((resolve) => {
        events.push('launch-check-started')
        finishLaunchCheck = () => {
          pendingConfig = 'older-launch-result'
          events.push('launch-check-settled')
          resolve()
        }
      })
    )
    mocks.downloadLatestRecommendations.mockImplementation(async () => {
      events.push('manual-download')
      installedConfig = 'newer-explicit-result'
      pendingConfig = null
    })

    const launchCheck = checkDependenciesAtLaunch()
    expect(events).toEqual(['launch-check-started'])

    const sender = new FakeSender()
    await expect(invoke('dependencies:downloadRecommendations', sender)).rejects.toThrow(
      'Dependency recommendations operation is already running'
    )
    expect(mocks.downloadLatestRecommendations).not.toHaveBeenCalled()

    finishLaunchCheck()
    await launchCheck

    await expect(invoke('dependencies:downloadRecommendations', sender)).resolves.toBeTruthy()
    expect(events).toEqual([
      'launch-check-started',
      'launch-check-settled',
      'manual-download',
    ])
    expect(installedConfig).toBe('newer-explicit-result')
    expect(pendingConfig).toBeNull()
  })

  it('skips the occupied launch dependency while allowing its independent check', async () => {
    const sender = new FakeSender()
    let finishManualDownload!: () => void
    mocks.downloadLatestRecommendations.mockImplementation(
      () => new Promise<void>((resolve) => {
        finishManualDownload = resolve
      })
    )
    mocks.checkRecommendations.mockResolvedValue(undefined)

    const manualDownload = invoke('dependencies:downloadRecommendations', sender)
    await checkDependenciesAtLaunch()

    expect(mocks.checkRecommendations).not.toHaveBeenCalled()
    expect(mocks.resolveLatestCliRelease).toHaveBeenCalledTimes(1)

    finishManualDownload()
    await expect(manualDownload).resolves.toBeTruthy()

    mocks.checkRecommendations.mockResolvedValue(undefined)
    await checkDependenciesAtLaunch()
    expect(mocks.checkRecommendations).toHaveBeenCalledTimes(1)
  })
})
