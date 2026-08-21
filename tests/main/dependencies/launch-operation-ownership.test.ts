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
  getRecommendationsStatus: () => ({
    exists: false,
    valid: false,
    entryCount: 0,
    updatedAt: null,
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
})

afterEach(() => {
  fs.rmSync(mocks.home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

describe('launch and manual dependency operation ownership', () => {
  it('checks only CLI metadata at launch while explicit recommendations acquisition remains independent', async () => {
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
})
