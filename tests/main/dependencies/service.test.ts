import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { fetchLatestRecommendationsModified } from '../../../src/main/recommendations'
import { checkAllDependencies, getDependenciesState } from '../../../src/main/dependencies/service'
import { readDependenciesCache } from '../../../src/main/dependencies/store'
import { createDefaultConfig } from '../../../src/main/config/defaults'

const resolveMock = resolveLatestCliRelease as unknown as ReturnType<typeof vi.fn>
const serverTimeMock = fetchLatestRecommendationsModified as unknown as ReturnType<typeof vi.fn>

let home: string
let prevHome: string | undefined

beforeEach(() => {
  prevHome = process.env.IMAGEQUEUE_HOME
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-svc-'))
  process.env.IMAGEQUEUE_HOME = home
  // Seed the canonical config directly so loadConfig does not perform a managed-
  // text first-run write and open the process-wide backup database during this
  // isolated dependency-service test.
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(createDefaultConfig()))
  resolveMock.mockReset()
  serverTimeMock.mockReset()
  serverTimeMock.mockResolvedValue('2026-09-11T20:46:05.000Z')
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.IMAGEQUEUE_HOME
  else process.env.IMAGEQUEUE_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

describe('checkAllDependencies — CLI check honesty (invariant I3)', () => {
  it('writes NO persisted CLI fact when the latest-release lookup fails', async () => {
    resolveMock.mockResolvedValue(null) // offline / rate-limited / non-200
    await expect(checkAllDependencies()).rejects.toThrow('Could not reach')
    const cli = readDependenciesCache().cli
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
    const cli = readDependenciesCache().cli
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
      JSON.stringify({ tag: 'v1.20260430.0', sha256: 'a'.repeat(64), installedAt: '2026-06-30T00:00:00.000Z' }),
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
      JSON.stringify({ tag: 'garbage-v1.20260430.0', sha256: 'a'.repeat(64), installedAt: '2026-06-30T00:00:00.000Z' }),
    )
    resolveMock.mockResolvedValue({ tag: 'v1.20260430.0', assetUrl: 'https://x', sha256: 'a' })

    const state = await checkAllDependencies()

    expect(state.cli.installedLabel).toBeNull()
    expect(state.cli.state).toBe('installed-unchecked')
  })
})

describe('recommendations lifecycle', () => {
  const server = '2026-09-11T20:46:05.000Z'

  function writeFile(modifiedUtc: string): void {
    const models = path.join(home, 'models')
    fs.mkdirSync(models, { recursive: true })
    const file = path.join(models, 'configs.json')
    fs.writeFileSync(file, JSON.stringify([{ name: 'current', configuration: { model: 'm' } }]))
    fs.utimesSync(file, new Date(), new Date(modifiedUtc))
  }

  it('keeps a present file installed-unchecked with no synthetic latest/check facts before any check', () => {
    writeFile(server)
    const info = getDependenciesState().recommendations
    expect(info.state).toBe('installed-unchecked')
    expect(info.latestLabel).toBeNull()
    expect(info.lastCheckedAtUtc).toBeNull()
  })

  it('reads up to date once a check finds the server time the file carries', async () => {
    writeFile(server)
    resolveMock.mockResolvedValue({ tag: 'v26.0910.1', assetUrl: 'https://x', sha256: 'a' })
    const state = await checkAllDependencies()
    expect(state.recommendations.state).toBe('up-to-date')
    expect(state.recommendations.lastCheckedAtUtc).not.toBeNull()
  })

  it('reads update available when the server changed the file after this copy', async () => {
    writeFile('2026-08-22T20:13:13.000Z')
    resolveMock.mockResolvedValue({ tag: 'v26.0910.1', assetUrl: 'https://x', sha256: 'a' })
    const state = await checkAllDependencies()
    expect(state.recommendations.state).toBe('update-available')
  })

  it('records the CLI result and no file facts when only the file check fails', async () => {
    writeFile(server)
    resolveMock.mockResolvedValue({ tag: 'v26.0910.1', assetUrl: 'https://x', sha256: 'a' })
    serverTimeMock.mockRejectedValue(new Error('offline'))
    await expect(checkAllDependencies()).rejects.toThrow('offline')
    const cache = readDependenciesCache()
    expect(cache.cli.lastKnownLatest).toBe('v26.0910.1')
    expect(cache.recommendations).toEqual({ lastKnownModifiedUtc: null, lastCheckedAtUtc: null })
    expect(getDependenciesState().recommendations.state).toBe('installed-unchecked')
  })
})
