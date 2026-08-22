import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  publishCliBinary,
  readInstalledCliTag,
} from '../../../src/main/dependencies/cli-binary'
import {
  getBinDir,
  getCliBinaryPath,
  getCliMetaPath,
} from '../../../src/main/dependencies/paths'

let home: string
let previousHome: string | undefined

beforeEach(() => {
  previousHome = process.env.IMAGEQUEUE_HOME
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-cli-publish-'))
  process.env.IMAGEQUEUE_HOME = home
})

afterEach(() => {
  vi.restoreAllMocks()
  if (previousHome === undefined) delete process.env.IMAGEQUEUE_HOME
  else process.env.IMAGEQUEUE_HOME = previousHome
  fs.rmSync(home, { recursive: true, force: true })
})

describe('publishCliBinary', () => {
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
    fs.writeFileSync(getCliMetaPath(), JSON.stringify({
      tag: 'v1.20260101.0',
      sha256: 'b'.repeat(64),
      installedAt: '2026-01-01T00:00:00.000Z',
    }))
    const staged = path.join(home, 'new-cli')
    fs.writeFileSync(staged, 'new binary')

    const realRename = fs.renameSync.bind(fs)
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (path.resolve(String(destination)) === path.resolve(getCliMetaPath())) {
        throw new Error('sidecar publication failed')
      }
      realRename(source, destination)
    })

    expect(() => publishCliBinary(staged, 'v1.20260822.0', 'a'.repeat(64)))
      .toThrow('sidecar publication failed')
    expect(fs.readFileSync(getCliBinaryPath(), 'utf8')).toBe('new binary')
    expect(fs.existsSync(getCliMetaPath())).toBe(false)
    expect(readInstalledCliTag()).toBeNull()
  })
})
