import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Mock the network release lookup so the service runs offline and deterministically.
vi.mock('../../../src/main/dependencies/cli-release', () => ({
  resolveLatestCliRelease: vi.fn(),
}))

// And the configs.json server-time request, so no test reaches the network.
vi.mock('../../../src/main/recommendations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/main/recommendations')>()),
  fetchLatestRecommendationsModified: vi.fn(),
}))

import { resolveLatestCliRelease } from '../../../src/main/dependencies/cli-release'
import * as cliBinary from '../../../src/main/dependencies/cli-binary'
import * as fsync from '../../../src/main/utils/fsync'
import { fetchLatestRecommendationsModified } from '../../../src/main/recommendations'
import {
  checkAllDependencies,
  checkDependenciesAtLaunch,
  getDependenciesState,
  installOrUpdateCli,
} from '../../../src/main/dependencies/service'
import { readDependenciesCache, updateDependenciesCache } from '../../../src/main/dependencies/store'
import { createDefaultConfig } from '../../../src/main/config/defaults'
import { recordServerTime } from '../../../src/main/dependencies/recommendations-times'

const resolveMock = resolveLatestCliRelease as unknown as ReturnType<typeof vi.fn>
const serverTimeMock = fetchLatestRecommendationsModified as unknown as ReturnType<typeof vi.fn>

let home: string
let prevHome: string | undefined

beforeEach(() => {
  prevHome = process.env.IMAGEQUEUE_DATA_DIR
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-svc-'))
  process.env.IMAGEQUEUE_DATA_DIR = home
  // Seed the canonical config directly so loadConfig does not perform a managed-
  // text first-run write and open the process-wide backup database during this
  // isolated dependency-service test.
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(createDefaultConfig()))
  resolveMock.mockReset()
  serverTimeMock.mockReset()
  serverTimeMock.mockResolvedValue('2026-09-11T20:46:05.000Z')
})

afterEach(() => {
  vi.restoreAllMocks()
  if (prevHome === undefined) delete process.env.IMAGEQUEUE_DATA_DIR
  else process.env.IMAGEQUEUE_DATA_DIR = prevHome
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

describe('checkAllDependencies — CLI check honesty (invariant I3)', () => {
  it('reports a secondary sync warning when check facts were published before their sync failed', async () => {
    const tag = 'v1.20261004.0'
    resolveMock.mockResolvedValue({ tag, assetUrl: 'https://fixture.invalid/cli', sha256: 'a'.repeat(64) })
    vi.spyOn(cliBinary, 'installCliRelease').mockImplementation(async () => {
      const staged = path.join(home, 'verified-cli')
      fs.writeFileSync(staged, 'verified fixture')
      return cliBinary.publishCliBinary(staged, tag)
    })
    const sync = fsync.syncDirectoryAsync
    vi.spyOn(fsync, 'syncDirectoryAsync').mockImplementation(async (directory) => {
      if (directory === home) throw new Error('check-cache sync failed')
      await sync(directory)
    })
    const result = await installOrUpdateCli()
    expect(result.warnings).toEqual(['sync-incomplete'])
    expect(result.state.cli).toMatchObject({ state: 'up-to-date', installedLabel: tag, latestLabel: tag })
    expect((await readDependenciesCache()).cli.lastKnownLatest).toBe(tag)
  })

  it('returns the physically installed CLI with a warning when secondary check-cache persistence fails', async () => {
    const tag = 'v1.20261004.0'
    resolveMock.mockResolvedValue({ tag, assetUrl: 'https://fixture.invalid/cli', sha256: 'a'.repeat(64) })
    vi.spyOn(cliBinary, 'installCliRelease').mockImplementation(async () => {
      const staged = path.join(home, 'verified-cli')
      fs.writeFileSync(staged, 'verified fixture')
      return cliBinary.publishCliBinary(staged, tag)
    })
    const rename = fs.renameSync
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (source, target) => {
      if (String(target) === path.join(home, 'dependencies.json')) throw new Error('EACCES /private SECRET_SENTINEL')
      rename(source, target)
    })
    const result = await installOrUpdateCli()
    expect(result.warnings).toEqual(['check-not-saved'])
    expect(result.state.cli).toMatchObject({ state: 'installed-unchecked', installedLabel: tag })
    expect(fs.readFileSync(path.join(home, 'bin', 'draw-things-cli'), 'utf8')).toBe('verified fixture')
    expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL')
  })

  it('writes NO persisted CLI fact when the latest-release lookup fails', async () => {
    resolveMock.mockResolvedValue(null) // offline / rate-limited / non-200
    await expect(checkAllDependencies()).rejects.toThrow('Could not reach')
    const cli = (await readDependenciesCache()).cli
    expect(cli.lastCheckedAtUtc).toBeNull()
    expect(cli.lastKnownLatest).toBeNull()
  })

  it('records the checked-at timestamp and latest tag only on a successful lookup', async () => {
    resolveMock.mockResolvedValue({
      tag: 'v1.20260501.0',
      assetUrl: 'https://example.com/draw-things-cli',
      sha256: 'abc',
    })
    await checkAllDependencies()
    const cli = (await readDependenciesCache()).cli
    expect(cli.lastKnownLatest).toBe('v1.20260501.0')
    expect(cli.lastCheckedAtUtc).not.toBeNull()
  })
})

// The installed version comes from the sidecar beside the binary, so a binary the
// app has no record of installing — hand-placed, or left by an install whose
// sidecar write did not land — is present with an UNKNOWN version. That is not
// absent, and with nothing to compare it can never read as up to date.
describe('a present CLI whose version cannot be read', () => {
  function placeBinaryWithoutSidecar(): void {
    const bin = path.join(home, 'bin')
    fs.mkdirSync(bin, { recursive: true })
    fs.writeFileSync(path.join(bin, 'draw-things-cli'), 'not a real binary')
  }

  it('reads installed-unchecked with no version, even after a successful check', async () => {
    placeBinaryWithoutSidecar()
    resolveMock.mockResolvedValue({ tag: 'v1.20260430.0', assetUrl: 'https://x', sha256: 'a' })

    const state = await checkAllDependencies()

    expect(state.cli.installedLabel).toBeNull()
    expect(state.cli.latestLabel).toBe('v1.20260430.0')
    expect(state.cli.state).toBe('installed-unchecked')
  })

  it('reads its version once the sidecar is beside it', async () => {
    placeBinaryWithoutSidecar()
    fs.writeFileSync(
      path.join(home, 'bin', 'draw-things-cli.json'),
      JSON.stringify({
        formatVersion: 1, tag: 'v1.20260430.0', sha256: 'a'.repeat(64), installedAt: '2026-06-30T00:00:00.000Z',
        binaryId: String(fs.statSync(path.join(home, 'bin', 'draw-things-cli'), { bigint: true }).ino),
      }),
    )
    resolveMock.mockResolvedValue({ tag: 'v1.20260430.0', assetUrl: 'https://x', sha256: 'a' })

    const state = await checkAllDependencies()

    expect(state.cli.installedLabel).toBe('v1.20260430.0')
    expect(state.cli.state).toBe('up-to-date')
  })

  it('treats a malformed truthy sidecar tag as unreadable so re-acquisition is offered', async () => {
    placeBinaryWithoutSidecar()
    fs.writeFileSync(
      path.join(home, 'bin', 'draw-things-cli.json'),
      JSON.stringify({ formatVersion: 1, tag: 'garbage-v1.20260430.0', sha256: 'a'.repeat(64), installedAt: '2026-06-30T00:00:00.000Z' }),
    )
    resolveMock.mockResolvedValue({ tag: 'v1.20260430.0', assetUrl: 'https://x', sha256: 'a' })

    const state = await checkAllDependencies()

    expect(state.cli.installedLabel).toBeNull()
    expect(state.cli.state).toBe('installed-unchecked')
  })
})

describe('recommendations lifecycle', () => {
  const server = '2026-09-11T20:46:05.000Z'

  // A file as Install/Refresh leaves it: the bytes, and their server time recorded for them.
  async function writeFile(modifiedUtc: string | null): Promise<void> {
    const models = path.join(home, 'models')
    fs.mkdirSync(models, { recursive: true })
    const file = path.join(models, 'configs.json')
    const bytes = Buffer.from(JSON.stringify([{ name: 'current', configuration: { model: 'm' } }]))
    fs.writeFileSync(file, bytes)
    await recordServerTime(file, bytes, modifiedUtc)
  }

  it('keeps a present file installed-unchecked with no synthetic latest/check facts before any check', async () => {
    await writeFile(server)
    const info = await (await getDependenciesState()).recommendations
    expect(info.state).toBe('installed-unchecked')
    expect(info.latestLabel).toBeNull()
    expect(info.lastCheckedAtUtc).toBeNull()
  })

  it('reads up to date once a check finds the server time the file carries', async () => {
    await writeFile(server)
    resolveMock.mockResolvedValue({ tag: 'v26.0910.1', assetUrl: 'https://x', sha256: 'a' })
    const state = await checkAllDependencies()
    expect(state.recommendations.state).toBe('up-to-date')
    expect(state.recommendations.lastCheckedAtUtc).not.toBeNull()
  })

  it('reads update available when the server changed the file after this copy', async () => {
    await writeFile('2026-08-22T20:13:13.000Z')
    resolveMock.mockResolvedValue({ tag: 'v26.0910.1', assetUrl: 'https://x', sha256: 'a' })
    const state = await checkAllDependencies()
    expect(state.recommendations.state).toBe('update-available')
  })

  it('stays unchecked with no date for a file no install recorded, whatever its modification time', async () => {
    await writeFile(null)
    fs.utimesSync(path.join(home, 'models', 'configs.json'), new Date(), new Date(server))
    resolveMock.mockResolvedValue({ tag: 'v26.0910.1', assetUrl: 'https://x', sha256: 'a' })
    const state = await checkAllDependencies()
    expect(state.recommendations.state).toBe('installed-unchecked')
    expect(state.recommendations.updatedAtUtc).toBeNull()
  })

  it('records the CLI result and no file facts when only the file check fails', async () => {
    await writeFile(server)
    resolveMock.mockResolvedValue({ tag: 'v26.0910.1', assetUrl: 'https://x', sha256: 'a' })
    serverTimeMock.mockRejectedValue(new Error('offline'))
    await expect(checkAllDependencies()).rejects.toThrow('offline')
    const cache = (await readDependenciesCache())
    expect(cache.cli.lastKnownLatest).toBe('v26.0910.1')
    expect(cache.recommendations).toEqual({ lastKnownModifiedUtc: null, lastCheckedAtUtc: null })
    expect(await (await getDependenciesState()).recommendations.state).toBe('installed-unchecked')
  })
})

describe('the launch check, throttled by the last attempt', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const day = 24 * 60 * 60 * 1000

  beforeAll(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
  })

  afterAll(() => {
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
  })

  async function setLastAttempt(value: string): Promise<void> {
    await updateDependenciesCache((cache) => {
      cache.lastAttemptAtUtc = value
    })
  }

  it('records the attempt before a failed check and waits a day after it', async () => {
    resolveMock.mockResolvedValue(null)
    await checkDependenciesAtLaunch()
    expect(resolveMock).toHaveBeenCalledTimes(1)
    expect((await readDependenciesCache()).lastAttemptAtUtc).not.toBeNull()
    expect((await readDependenciesCache()).cli.lastCheckedAtUtc).toBeNull()

    await checkDependenciesAtLaunch()
    expect(resolveMock).toHaveBeenCalledTimes(1)
  })

  it('waits after a manual check attempt too, even a failed one', async () => {
    resolveMock.mockResolvedValue(null)
    await expect(checkAllDependencies()).rejects.toThrow('Could not reach')
    expect((await readDependenciesCache()).lastAttemptAtUtc).not.toBeNull()

    await checkDependenciesAtLaunch()
    expect(resolveMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a day old', () => new Date(Date.now() - day).toISOString()],
    ['in the future', () => new Date(Date.now() + day).toISOString()],
    ['invalid', () => 'not a date'],
  ])('runs when the last attempt is %s', async (_label, lastAttempt) => {
    await setLastAttempt(lastAttempt())
    resolveMock.mockResolvedValue({ tag: 'v26.0910.1', assetUrl: 'https://x', sha256: 'a' })
    await checkDependenciesAtLaunch()
    expect(resolveMock).toHaveBeenCalledTimes(1)
    expect(Date.parse((await readDependenciesCache()).lastAttemptAtUtc!)).toBeLessThanOrEqual(Date.now())
  })
})
