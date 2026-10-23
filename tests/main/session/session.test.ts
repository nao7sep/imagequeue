import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionDir } from '../../../src/main/session/session'
import { formatTimestamp, utcStampForFilename } from '../../../src/shared/utc-stamp'
import * as sync from '../../../src/main/utils/fsync'

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

  it('waits for root durability before claiming a session and parent durability before returning', async () => {
    let settleRoot!: () => void
    let settleParent!: () => void
    const rootSync = new Promise<void>(resolve => { settleRoot = resolve })
    const parentSync = new Promise<void>(resolve => { settleParent = resolve })
    const directorySync = vi.spyOn(sync, 'syncDirectoryAsync')
      .mockImplementationOnce(() => rootSync)
      .mockImplementationOnce(() => parentSync)
    const sessionsDir = path.join(tmpRoot, 'sessions')
    const nextDir = path.join(sessionsDir, '20260604-093015-utc')
    let returned = false
    const creation = createSessionDir(new Date(Date.UTC(2026, 5, 4, 9, 30, 15))).then(dir => {
      returned = true
      return dir
    })

    await vi.waitFor(() => expect(directorySync).toHaveBeenCalledTimes(1))
    expect(directorySync.mock.calls).toEqual([[tmpRoot]])
    expect(fs.existsSync(sessionsDir)).toBe(true)
    expect(fs.existsSync(nextDir)).toBe(false)
    expect(returned).toBe(false)

    settleRoot()
    await vi.waitFor(() => expect(directorySync).toHaveBeenCalledTimes(2))
    expect(directorySync.mock.calls).toEqual([[tmpRoot], [sessionsDir]])
    expect(fs.existsSync(nextDir)).toBe(true)
    expect(returned).toBe(false)

    settleParent()
    await expect(creation).resolves.toBe(nextDir)
  })

  it('retries root durability when sessions already exists after a failed sync', async () => {
    const failure = new Error('root sync failed')
    const directorySync = vi.spyOn(sync, 'syncDirectoryAsync')
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(undefined)
    const launchTime = new Date(Date.UTC(2026, 5, 4, 9, 30, 15))
    const sessionsDir = path.join(tmpRoot, 'sessions')

    await expect(createSessionDir(launchTime)).rejects.toBe(failure)
    expect(fs.readdirSync(sessionsDir)).toEqual([])
    await expect(createSessionDir(launchTime)).resolves.toBe(path.join(sessionsDir, '20260604-093015-utc'))
    expect(directorySync.mock.calls).toEqual([[tmpRoot], [tmpRoot], [sessionsDir]])
  })

  it('removes only its newly created empty session when parent durability fails', async () => {
    const failure = new Error('parent sync failed')
    vi.spyOn(sync, 'syncDirectoryAsync').mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure)
    const sessionsDir = path.join(tmpRoot, 'sessions')
    fs.mkdirSync(path.join(sessionsDir, 'existing'), { recursive: true })
    fs.writeFileSync(path.join(sessionsDir, 'existing', 'session.json'), 'kept')

    await expect(createSessionDir(new Date(Date.UTC(2026, 5, 4, 9, 30, 15)))).rejects.toBe(failure)
    expect(fs.readdirSync(sessionsDir)).toEqual(['existing'])
    expect(fs.readFileSync(path.join(sessionsDir, 'existing', 'session.json'), 'utf8')).toBe('kept')
  })

  it('preserves the sync failure and any work that prevents empty-directory cleanup', async () => {
    const failure = new Error('parent sync failed')
    const nextDir = path.join(tmpRoot, 'sessions', '20260604-093015-utc')
    vi.spyOn(sync, 'syncDirectoryAsync').mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
      fs.writeFileSync(path.join(nextDir, 'session.json'), 'kept')
      throw failure
    })

    await expect(createSessionDir(new Date(Date.UTC(2026, 5, 4, 9, 30, 15)))).rejects.toBe(failure)
    expect(fs.readFileSync(path.join(nextDir, 'session.json'), 'utf8')).toBe('kept')
  })

  // One creator under the single-instance lock: a name taken in the same
  // second fails, and the session already there is left as it was.
  it('fails on a name already taken in the same second, leaving that folder untouched', async () => {
    const directorySync = vi.spyOn(sync, 'syncDirectoryAsync').mockResolvedValue(undefined)
    const launchTime = new Date(Date.UTC(2026, 5, 4, 9, 30, 15, 123))
    const first = (await createSessionDir(launchTime))
    fs.writeFileSync(path.join(first, 'session.json'), 'kept')
    await expect(createSessionDir(new Date(Date.UTC(2026, 5, 4, 9, 30, 15, 900)))).rejects.toThrow(/EEXIST/)
    expect(fs.readdirSync(first)).toEqual(['session.json'])
    expect(fs.readFileSync(path.join(first, 'session.json'), 'utf8')).toBe('kept')
    expect(directorySync.mock.calls).toEqual([[tmpRoot], [path.join(tmpRoot, 'sessions')], [tmpRoot]])
  })
})
