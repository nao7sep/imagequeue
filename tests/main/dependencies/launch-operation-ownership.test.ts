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
  downloadLatestRecommendations: vi.fn(),
  fetchLatestRecommendationsModified: vi.fn(),
  recommendationsPresent: false,
}))

vi.mock('../../../src/main/ipc-boundary', () => ({
  handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
}))

vi.mock('../../../src/main/config', () => ({
  getDataDir: () => mocks.home,
  loadConfig: () => ({
    image_backends: { drawthings: { check_updates_at_launch: true } },
  }),
  saveConfig: vi.fn(),
}))

vi.mock('../../../src/main/dependencies/cli-release', () => ({
  resolveLatestCliRelease: mocks.resolveLatestCliRelease,
}))

vi.mock('../../../src/main/recommendations', () => ({
  downloadLatestRecommendations: mocks.downloadLatestRecommendations,
  fetchLatestRecommendationsModified: mocks.fetchLatestRecommendationsModified,
  getRecommendationsStatus: () => ({
    exists: mocks.recommendationsPresent,
    valid: mocks.recommendationsPresent,
    entryCount: mocks.recommendationsPresent ? 1 : 0,
    updatedAt: mocks.recommendationsPresent ? '2026-09-11T20:46:05.000Z' : null,
  }),
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
  mocks.downloadLatestRecommendations.mockReset()
  mocks.fetchLatestRecommendationsModified.mockReset()
  mocks.recommendationsPresent = false
})

afterEach(() => {
  fs.rmSync(mocks.home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

describe('launch and manual dependency operation ownership', () => {
  it('checks only CLI metadata at launch when no recommendations file is present', async () => {
    let finishCliCheck!: () => void
    mocks.resolveLatestCliRelease.mockImplementation(
      () => new Promise((resolve) => {
        finishCliCheck = () => resolve({
          tag: 'v1.20260822.0',
          assetUrl: 'https://example.com/draw-things-cli',
          sha256: 'abc',
        })
      })
    )
    mocks.downloadLatestRecommendations.mockResolvedValue(undefined)

    const launchCheck = checkDependenciesAtLaunch()
    const recommendations = invoke('dependencies:downloadRecommendations', new FakeSender())

    await expect(recommendations).resolves.toBeTruthy()
    expect(mocks.downloadLatestRecommendations).toHaveBeenCalledTimes(1)
    finishCliCheck()
    await launchCheck
  })

  it('retains the CLI slot until launch metadata settles', async () => {
    let finishCliCheck!: () => void
    mocks.resolveLatestCliRelease.mockImplementation(
      () => new Promise((resolve) => {
        finishCliCheck = () => resolve({
          tag: 'v1.20260822.0',
          assetUrl: 'https://example.com/draw-things-cli',
          sha256: 'abc',
        })
      })
    )

    const launchCheck = checkDependenciesAtLaunch()
    await expect(invoke('dependencies:installCli', new FakeSender())).rejects.toThrow(
      'Dependency cli operation is already running'
    )

    finishCliCheck()
    await launchCheck
  })

  it('checks a present file at launch in its own slot, apart from the CLI', async () => {
    mocks.recommendationsPresent = true
    let finishCliCheck!: () => void
    let finishFileCheck!: () => void
    mocks.resolveLatestCliRelease.mockImplementation(
      () => new Promise((resolve) => {
        finishCliCheck = () => resolve({
          tag: 'v26.0910.1',
          assetUrl: 'https://example.com/draw-things-cli',
          sha256: 'abc',
        })
      })
    )
    mocks.fetchLatestRecommendationsModified.mockImplementation(
      () => new Promise((resolve) => {
        finishFileCheck = () => resolve('2026-09-11T20:46:05.000Z')
      })
    )
    mocks.downloadLatestRecommendations.mockResolvedValue(undefined)

    const launchCheck = checkDependenciesAtLaunch()
    expect(mocks.fetchLatestRecommendationsModified).toHaveBeenCalledTimes(1)
    await expect(invoke('dependencies:downloadRecommendations', new FakeSender())).rejects.toThrow(
      'Dependency recommendations operation is already running'
    )

    // Once the file's check settles, its slot frees while the CLI's is still held.
    finishFileCheck()
    await vi.waitFor(() => invoke('dependencies:downloadRecommendations', new FakeSender()))
    expect(mocks.downloadLatestRecommendations).toHaveBeenCalledTimes(1)
    await expect(invoke('dependencies:installCli', new FakeSender())).rejects.toThrow(
      'Dependency cli operation is already running'
    )

    finishCliCheck()
    await launchCheck
  })
})
