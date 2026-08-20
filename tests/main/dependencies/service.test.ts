import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Mock the network release lookup so the service runs offline and deterministically.
vi.mock('../../../src/main/dependencies/cli-release', () => ({
  resolveLatestCliRelease: vi.fn(),
}))

import { resolveLatestCliRelease } from '../../../src/main/dependencies/cli-release'
import { checkAllDependencies } from '../../../src/main/dependencies/service'
import { readDependenciesCache } from '../../../src/main/dependencies/store'

const resolveMock = resolveLatestCliRelease as unknown as ReturnType<typeof vi.fn>

let home: string
let prevHome: string | undefined

beforeEach(() => {
  prevHome = process.env.IMAGEQUEUE_HOME
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-svc-'))
  process.env.IMAGEQUEUE_HOME = home
  resolveMock.mockReset()
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.IMAGEQUEUE_HOME
  else process.env.IMAGEQUEUE_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

describe('checkAllDependencies — CLI check honesty (invariant I3)', () => {
  it('writes NO persisted CLI fact when the latest-release lookup fails', async () => {
    resolveMock.mockResolvedValue(null) // offline / rate-limited / non-200
    await checkAllDependencies()
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
      JSON.stringify({ tag: 'v1.20260430.0', sha256: 'a', installedAt: '2026-06-30T00:00:00.000Z' }),
    )
    resolveMock.mockResolvedValue({ tag: 'v1.20260430.0', assetUrl: 'https://x', sha256: 'a' })

    const state = await checkAllDependencies()

    expect(state.cli.installedLabel).toBe('v1.20260430.0')
    expect(state.cli.state).toBe('up-to-date')
  })
})
