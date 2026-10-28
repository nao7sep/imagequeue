import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionDir } from '../../../src/main/session/session'
import { formatTimestamp, utcStampForFilename } from '../../../src/shared/utc-stamp'

describe('formatTimestamp', () => {
  it('formats a UTC date as yyyymmdd-hhmmss', async () => {
    expect(formatTimestamp(new Date(Date.UTC(2026, 5, 4, 9, 30, 15)))).toBe('20260604-093015')
  })

  it('zero-pads single-digit month, day, and time fields', async () => {
    expect(formatTimestamp(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe('20260102-030405')
  })

  it('uses UTC regardless of the local timezone', async () => {
    // Epoch 0 is 1970-01-01T00:00:00Z.
    expect(formatTimestamp(new Date(0))).toBe('19700101-000000')
  })
})

describe('utcStampForFilename', () => {
  it('names a file or folder to the second, marked UTC', async () => {
    expect(utcStampForFilename(new Date(Date.UTC(2026, 5, 4, 9, 30, 15, 123)))).toBe('20260604-093015-utc')
  })
})

describe('createSessionDir (session directory naming)', () => {
  const ENV_VAR = 'IMAGEQUEUE_DATA_DIR'
  const originalHome = process.env[ENV_VAR]
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-session-'))
    process.env[ENV_VAR] = tmpRoot
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalHome === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = originalHome
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('names the session directory yyyymmdd-hhmmss-utc', async () => {
    const sessionDir = (await createSessionDir(new Date(Date.UTC(2026, 5, 4, 9, 30, 15, 123))))
    expect(path.basename(sessionDir)).toBe('20260604-093015-utc')
  })

  // One creator under the single-instance lock: a name taken in the same
  // second fails, and the session already there is left as it was.
  it('fails on a name already taken in the same second, leaving that folder untouched', async () => {
    const launchTime = new Date(Date.UTC(2026, 5, 4, 9, 30, 15, 123))
    const first = (await createSessionDir(launchTime))
    fs.writeFileSync(path.join(first, 'session.json'), 'kept')
    await expect(createSessionDir(new Date(Date.UTC(2026, 5, 4, 9, 30, 15, 900)))).rejects.toThrow(/EEXIST/)
    expect(fs.readdirSync(first)).toEqual(['session.json'])
    expect(fs.readFileSync(path.join(first, 'session.json'), 'utf8')).toBe('kept')
  })
})
