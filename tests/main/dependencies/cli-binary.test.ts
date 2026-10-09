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
import { FORMAT_VERSIONS } from '../../../src/main/store-format'
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
  it('returns installed with a secondary warning after postcommit directory sync fails', async () => {
    fs.mkdirSync(getBinDir(), { recursive: true })
    fs.writeFileSync(getCliBinaryPath(), 'old binary')
    const staged = path.join(home, 'new-cli')
    fs.writeFileSync(staged, 'new binary')
    vi.spyOn(fsync, 'syncDirectoryAsync').mockImplementationOnce(() => { throw new Error('sync failed') })
    expect(await publishCliBinary(staged, 'v1.20260822.0')).toEqual(['sync-incomplete'])
    expect(fs.readFileSync(getCliBinaryPath(), 'utf8')).toBe('new binary')
    expect(await readInstalledCliTag()).toBe('v1.20260822.0')
  })

  it('publishes the binary and its matching identity', async () => {
    fs.mkdirSync(getBinDir(), { recursive: true })
    const staged = path.join(home, 'new-cli')
    fs.writeFileSync(staged, 'new binary')

    await publishCliBinary(staged, 'v1.20260822.0')

    expect(fs.readFileSync(getCliBinaryPath(), 'utf8')).toBe('new binary')
    expect(await readInstalledCliTag()).toBe('v1.20260822.0')
  })

  it('cannot leave a new binary wearing a stale tag when sidecar publication fails', async () => {
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
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (source, destination) => {
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

    expect(await publishCliBinary(staged, 'v1.20260822.0')).toEqual(['identity-unavailable'])
    expect(fs.readFileSync(getCliBinaryPath(), 'utf8')).toBe('new binary')
    expect(fs.existsSync(getCliMetaPath())).toBe(true)
    expect(await readInstalledCliTag()).toBeNull()
  })

  it('preserves the old binary and identity when binary publication fails', async () => {
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
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (source, destination) => {
      if (path.resolve(String(destination)) === path.resolve(getCliBinaryPath())) {
        throw new Error('binary publication failed')
      }
      realRename(source, destination)
    })

    await expect(publishCliBinary(staged, 'v1.20260822.0'))
      .rejects.toThrow('binary publication failed')
    expect(fs.readFileSync(getCliBinaryPath(), 'utf8')).toBe('old binary')
    expect(await readInstalledCliTag()).toBe('v1.20260101.0')
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

  it('reads a sidecar that records the inode alone', async () => {
    installWithSidecar((ino) => String(ino))
    expect(await readInstalledCliTag()).toBe('v1.20260716.0')
  })

  it('does not name a different file with the recorded tag', async () => {
    installWithSidecar((ino) => String(ino + 1n))
    expect(await readInstalledCliTag()).toBeNull()
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

  // A cache of the binary's identity: the version is written, never checked.
  it('reads a sidecar with no format version by its fields', async () => {
    installWithSidecar({})
    expect(await readInstalledCliTag()).toBe('v1.20260716.0')
  })

  it('writes its format version first and reads it back', async () => {
    fs.mkdirSync(getBinDir(), { recursive: true })
    const staged = path.join(home, 'new-cli')
    fs.writeFileSync(staged, 'new binary')
    await publishCliBinary(staged, 'v1.20260822.0')
    expect(Object.keys(JSON.parse(fs.readFileSync(getCliMetaPath(), 'utf8')))).toEqual(['formatVersion', 'tag', 'binaryId'])
    expect(Object.entries(JSON.parse(fs.readFileSync(getCliMetaPath(), 'utf8')))[0]).toEqual(['formatVersion', FORMAT_VERSIONS.cliSidecar])
    expect(await readInstalledCliTag()).toBe('v1.20260822.0')
  })

  it('reads a sidecar from a newer version by its fields', async () => {
    installWithSidecar({ formatVersion: FORMAT_VERSIONS.cliSidecar + 1 })
    expect(await readInstalledCliTag()).toBe('v1.20260716.0')
  })

  it('replaces a sidecar from a newer version when a binary is published', async () => {
    installWithSidecar({ formatVersion: FORMAT_VERSIONS.cliSidecar + 1 })
    const staged = path.join(home, 'new-cli')
    fs.writeFileSync(staged, 'new binary')
    await publishCliBinary(staged, 'v1.20260822.0')
    expect(JSON.parse(fs.readFileSync(getCliMetaPath(), 'utf8'))).toMatchObject({ formatVersion: FORMAT_VERSIONS.cliSidecar, tag: 'v1.20260822.0' })
    expect(await readInstalledCliTag()).toBe('v1.20260822.0')
  })
})
