import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionDir } from '../../../src/main/session/session'
import { formatTimestamp, formatTimestampMs } from '../../../src/shared/utc-stamp'

describe('formatTimestamp', () => {
  it('formats a UTC date as yyyymmdd-hhmmss', () => {
    expect(formatTimestamp(new Date(Date.UTC(2026, 5, 4, 9, 30, 15)))).toBe('20260604-093015')
  })

  it('zero-pads single-digit month, day, and time fields', () => {
    expect(formatTimestamp(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe('20260102-030405')
  })

  it('uses UTC regardless of the local timezone', () => {
    // Epoch 0 is 1970-01-01T00:00:00Z.
    expect(formatTimestamp(new Date(0))).toBe('19700101-000000')
  })
})

describe('formatTimestampMs', () => {
  it('formats a UTC date as yyyymmdd-hhmmss-fff (millisecond precision)', () => {
    expect(formatTimestampMs(new Date(Date.UTC(2026, 5, 4, 9, 30, 15, 123)))).toBe('20260604-093015-123')
  })

  it('zero-pads a single/double-digit millisecond field', () => {
    expect(formatTimestampMs(new Date(Date.UTC(2026, 5, 4, 9, 30, 15, 7)))).toBe('20260604-093015-007')
    expect(formatTimestampMs(new Date(Date.UTC(2026, 5, 4, 9, 30, 15, 42)))).toBe('20260604-093015-042')
  })
})

describe('createSessionDir (session directory naming)', () => {
  const ENV_VAR = 'IMAGEQUEUE_HOME'
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

  it('names the session directory yyyymmdd-hhmmss-fff-utc (millisecond precision, per the session-log filename convention)', () => {
    const sessionDir = createSessionDir(new Date(Date.UTC(2026, 5, 4, 9, 30, 15, 123)))
    expect(path.basename(sessionDir)).toBe('20260604-093015-123-utc')
  })

  it('claims a unique directory atomically when the preferred launch timestamp already exists', () => {
    const launchTime = new Date(Date.UTC(2026, 5, 4, 9, 30, 15, 123))
    // Simulate the TOCTOU mutation directly: an exists probe lies that the path
    // is free even after the first creator claimed it. The former
    // existsSync+recursive-mkdir implementation then returned the same path;
    // the fixed implementation never consults the probe.
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    const first = createSessionDir(launchTime)
    const second = createSessionDir(launchTime)

    expect(path.basename(first)).toBe('20260604-093015-123-utc')
    expect(path.basename(second)).toBe('20260604-093015-124-utc')
    expect(first).not.toBe(second)
  })
})
