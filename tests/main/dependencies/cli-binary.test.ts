import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installCliRelease,
  publishCliBinary,
  readInstalledCliTag,
} from '../../../src/main/dependencies/cli-binary'
import {
  getBinDir,
  getCliBinaryPath,
  getCliMetaPath,
} from '../../../src/main/dependencies/paths'
import { FORMAT_VERSIONS, NewerFormatError } from '../../../src/main/store-format'
import * as fsync from '../../../src/main/utils/fsync'

let home: string
let previousHome: string | undefined

beforeEach(() => {
  previousHome = process.env.IMAGEQUEUE_DATA_DIR
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-cli-publish-'))
  process.env.IMAGEQUEUE_DATA_DIR = home
})

afterEach(() => {
  vi.restoreAllMocks()
  if (previousHome === undefined) delete process.env.IMAGEQUEUE_DATA_DIR
  else process.env.IMAGEQUEUE_DATA_DIR = previousHome
  fs.rmSync(home, { recursive: true, force: true })
})

describe('publishCliBinary', () => {
  it.each([false, true])('refuses a newer governing sidecar at final publication (orphan: %s)', (orphan) => {
    fs.mkdirSync(getBinDir(), { recursive: true })
    if (!orphan) fs.writeFileSync(getCliBinaryPath(), 'newer binary')
    const newer = JSON.stringify({ formatVersion: FORMAT_VERSIONS.cliSidecar + 1 })
    fs.writeFileSync(getCliMetaPath(), newer)
    const staged = path.join(home, 'new-cli')
    fs.writeFileSync(staged, 'staged binary')
    expect(() => publishCliBinary(staged, 'v1.20260822.0', 'a'.repeat(64))).toThrow(NewerFormatError)
    expect(fs.readFileSync(getCliMetaPath(), 'utf8')).toBe(newer)
    expect(fs.existsSync(getCliBinaryPath())).toBe(!orphan)
    if (!orphan) expect(fs.readFileSync(getCliBinaryPath(), 'utf8')).toBe('newer binary')
    expect(fs.readFileSync(staged, 'utf8')).toBe('staged binary')
  })

  it('returns installed with a secondary warning after postcommit directory sync fails', () => {
    fs.mkdirSync(getBinDir(), { recursive: true })
    fs.writeFileSync(getCliBinaryPath(), 'old binary')
    const staged = path.join(home, 'new-cli')
    fs.writeFileSync(staged, 'new binary')
    vi.spyOn(fsync, 'syncDirectory').mockImplementationOnce(() => { throw new Error('sync failed') })
    expect(publishCliBinary(staged, 'v1.20260822.0', 'a'.repeat(64))).toEqual(['sync-incomplete'])
    expect(fs.readFileSync(getCliBinaryPath(), 'utf8')).toBe('new binary')
    expect(readInstalledCliTag()).toBe('v1.20260822.0')
  })

  it('publishes the binary and its matching identity', () => {
    fs.mkdirSync(getBinDir(), { recursive: true })
    const staged = path.join(home, 'new-cli')
    fs.writeFileSync(staged, 'new binary')

    publishCliBinary(staged, 'v1.20260822.0', 'a'.repeat(64))

    expect(fs.readFileSync(getCliBinaryPath(), 'utf8')).toBe('new binary')
    expect(readInstalledCliTag()).toBe('v1.20260822.0')
  })

  it('cannot leave a new binary wearing a stale tag when sidecar publication fails', () => {
    fs.mkdirSync(getBinDir(), { recursive: true })
    fs.writeFileSync(getCliBinaryPath(), 'old binary')
    fs.writeFileSync(getCliMetaPath(), JSON.stringify({
      formatVersion: 1,
      tag: 'v1.20260101.0',
      sha256: 'b'.repeat(64),
      installedAt: '2026-01-01T00:00:00.000Z',
      binaryId: String(fs.statSync(getCliBinaryPath(), { bigint: true }).ino),
    }))
    const staged = path.join(home, 'new-cli')
    fs.writeFileSync(staged, 'new binary')

    const realRename = fs.renameSync.bind(fs)
    let metaPublications = 0
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (path.resolve(String(destination)) === path.resolve(getCliMetaPath())) {
        metaPublications += 1
        if (metaPublications === 1) throw new Error('sidecar publication failed')
      }
      // POSIX atomically replaces the prior binary. Emulate that behavior on
      // Windows, where renameSync does not replace an existing destination.
      if (path.resolve(String(destination)) === path.resolve(getCliBinaryPath())) {
        fs.rmSync(getCliBinaryPath())
      }
      realRename(source, destination)
    })

    expect(publishCliBinary(staged, 'v1.20260822.0', 'a'.repeat(64))).toEqual(['identity-unavailable'])
    expect(fs.readFileSync(getCliBinaryPath(), 'utf8')).toBe('new binary')
    expect(fs.existsSync(getCliMetaPath())).toBe(true)
    expect(readInstalledCliTag()).toBeNull()
  })

  it('preserves the old binary and identity when binary publication fails', () => {
    fs.mkdirSync(getBinDir(), { recursive: true })
    fs.writeFileSync(getCliBinaryPath(), 'old binary')
    fs.writeFileSync(getCliMetaPath(), JSON.stringify({
      formatVersion: 1,
      tag: 'v1.20260101.0',
      sha256: 'b'.repeat(64),
      installedAt: '2026-01-01T00:00:00.000Z',
      binaryId: String(fs.statSync(getCliBinaryPath(), { bigint: true }).ino),
    }))
    const staged = path.join(home, 'new-cli')
    fs.writeFileSync(staged, 'new binary')

    const realRename = fs.renameSync.bind(fs)
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (path.resolve(String(destination)) === path.resolve(getCliBinaryPath())) {
        throw new Error('binary publication failed')
      }
      realRename(source, destination)
    })

    expect(() => publishCliBinary(staged, 'v1.20260822.0', 'a'.repeat(64)))
      .toThrow('binary publication failed')
    expect(fs.readFileSync(getCliBinaryPath(), 'utf8')).toBe('old binary')
    expect(readInstalledCliTag()).toBe('v1.20260101.0')
  })
})

describe('readInstalledCliTag', () => {
  function installWithSidecar(binaryId: (ino: bigint, dev: bigint) => string): void {
    fs.mkdirSync(getBinDir(), { recursive: true })
    fs.writeFileSync(getCliBinaryPath(), 'binary')
    const { ino, dev } = fs.statSync(getCliBinaryPath(), { bigint: true })
    fs.writeFileSync(getCliMetaPath(), JSON.stringify({
      formatVersion: 1,
      tag: 'v1.20260716.0',
      sha256: 'c'.repeat(64),
      installedAt: '2026-08-22T20:13:13.750Z',
      binaryId: binaryId(ino, dev),
    }))
  }

  it('reads a sidecar that records the inode alone', () => {
    installWithSidecar((ino) => String(ino))
    expect(readInstalledCliTag()).toBe('v1.20260716.0')
  })

  it('does not name a different file with the recorded tag', () => {
    installWithSidecar((ino) => String(ino + 1n))
    expect(readInstalledCliTag()).toBeNull()
  })
})

describe('the sidecar format version', () => {
  function installWithSidecar(marker: Record<string, unknown>): void {
    fs.mkdirSync(getBinDir(), { recursive: true })
    fs.writeFileSync(getCliBinaryPath(), 'binary')
    fs.writeFileSync(getCliMetaPath(), JSON.stringify({
      ...marker,
      tag: 'v1.20260716.0',
      sha256: 'c'.repeat(64),
      installedAt: '2026-08-22T20:13:13.750Z',
      binaryId: String(fs.statSync(getCliBinaryPath(), { bigint: true }).ino),
    }))
  }

  it('reads a sidecar with no format version as unknown', () => {
    installWithSidecar({})
    expect(readInstalledCliTag()).toBeNull()
  })

  it('writes its format version first and reads it back', () => {
    fs.mkdirSync(getBinDir(), { recursive: true })
    const staged = path.join(home, 'new-cli')
    fs.writeFileSync(staged, 'new binary')
    publishCliBinary(staged, 'v1.20260822.0', 'a'.repeat(64))
    expect(Object.entries(JSON.parse(fs.readFileSync(getCliMetaPath(), 'utf8')))[0]).toEqual(['formatVersion', FORMAT_VERSIONS.cliSidecar])
    expect(readInstalledCliTag()).toBe('v1.20260822.0')
  })

  it('reads a sidecar from a newer version as unknown and leaves its bytes as they were', () => {
    installWithSidecar({ formatVersion: FORMAT_VERSIONS.cliSidecar + 1 })
    const bytes = fs.readFileSync(getCliMetaPath(), 'utf8')
    expect(readInstalledCliTag()).toBeNull()
    expect(fs.readFileSync(getCliMetaPath(), 'utf8')).toBe(bytes)
  })

  it('refuses Install/Update over a newer sidecar, keeping it and its binary', async () => {
    installWithSidecar({ formatVersion: FORMAT_VERSIONS.cliSidecar + 1 })
    const sidecar = fs.readFileSync(getCliMetaPath(), 'utf8')
    const release = { tag: 'v1.20261004.0', assetUrl: 'https://fixture.invalid/draw-things-cli', sha256: 'b'.repeat(64) }
    const refusal = await installCliRelease(release).catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(NewerFormatError)
    expect((refusal as NewerFormatError).path).toBe(getCliMetaPath())
    expect(fs.readFileSync(getCliMetaPath(), 'utf8')).toBe(sidecar)
    expect(fs.readFileSync(getCliBinaryPath(), 'utf8')).toBe('binary')
  })
})
