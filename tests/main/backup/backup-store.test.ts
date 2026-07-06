import fs from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { record, closeBackupStore } from '../../../src/main/backup/backup-store'
import * as logger from '../../../src/main/logger'

// The write-through data-backup store (data-backup conventions). These tests pin the store directly
// through its public record()/closeBackupStore() API, isolating the storage root with IMAGEQUEUE_HOME
// and reading ~/.imagequeue/backups.sqlite3 back with a second node:sqlite handle. They assert:
//   - content is a byte-identical BLOB (a CR/LF pair AND a non-UTF-8 byte prove raw-bytes fidelity),
//   - written_at_utc is the serialized ISO-8601-ms form, NOT the yyyymmdd-hhmmss filename stamp,
//   - dedup skips an unchanged re-save, while a changed save and a revert each insert a row,
//   - best-effort: an injected store failure never throws, logs one warn, and never touches the caller.

const ENV_VAR = 'IMAGEQUEUE_HOME'

/** Open a fresh read-only handle on the store file and return every row, oldest first. */
function readAllRows(storeFile: string): Array<{
  id: number
  path: string
  content: Uint8Array
  content_sha256: string
  byte_size: number
  written_at_utc: string
}> {
  const db = new DatabaseSync(storeFile)
  try {
    return db.prepare('SELECT * FROM backups ORDER BY id ASC').all() as never
  } finally {
    db.close()
  }
}

describe('write-through backup store', () => {
  let tmpRoot: string
  let storeFile: string
  const originalHome = process.env[ENV_VAR]

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-backupstore-'))
    process.env[ENV_VAR] = tmpRoot
    storeFile = path.join(tmpRoot, 'backups.sqlite3')
  })

  afterEach(() => {
    // Close the singleton so the next test re-opens against its own throwaway root, then restore env.
    closeBackupStore()
    if (originalHome === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = originalHome
    fs.rmSync(tmpRoot, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('creates backups.sqlite3 under the resolved root (honoring IMAGEQUEUE_HOME)', () => {
    record(path.join(tmpRoot, 'config.json'), Buffer.from('{}'))
    closeBackupStore()
    expect(fs.existsSync(storeFile)).toBe(true)
  })

  it('stores content as a byte-identical BLOB — a CR/LF pair and a non-UTF-8 byte survive verbatim', () => {
    const target = path.join(tmpRoot, 'config.json')
    // A CRLF pair (would be normalized by a naive text read), a UTF-8 BOM, and a raw 0xFF byte that is
    // not valid UTF-8 (would be corrupted to U+FFFD if decoded to a string). Storing the raw bytes must
    // preserve all three exactly.
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]), // BOM
      Buffer.from('line one\r\nline two', 'utf-8'),
      Buffer.from([0xff, 0x00, 0xfe]), // non-UTF-8 bytes incl. an embedded NUL
    ])
    record(target, bytes)
    closeBackupStore()

    const rows = readAllRows(storeFile)
    expect(rows).toHaveLength(1)
    expect(rows[0].path).toBe(target) // full absolute path, as written
    expect(rows[0].byte_size).toBe(bytes.byteLength)
    // The BLOB comes back as a Uint8Array; it must equal the exact input bytes.
    expect(Buffer.from(rows[0].content).equals(bytes)).toBe(true)
  })

  it('records content_sha256 over the raw bytes, matching a fresh SHA-256 of the same buffer', async () => {
    const { createHash } = await import('node:crypto')
    const target = path.join(tmpRoot, 'elaborators.json')
    const bytes = Buffer.from('some\r\nauthored\ttext', 'utf-8')
    const expected = createHash('sha256').update(bytes).digest('hex')

    record(target, bytes)
    closeBackupStore()

    const rows = readAllRows(storeFile)
    expect(rows[0].content_sha256).toBe(expected)
  })

  it('writes written_at_utc as serialized ISO-8601-ms (Z), never the yyyymmdd-hhmmss filename stamp', () => {
    record(path.join(tmpRoot, 'config.json'), Buffer.from('{}'))
    closeBackupStore()

    const [row] = readAllRows(storeFile)
    // Exactly the toISOString() shape: 2026-07-06T05:18:52.225Z — 3 fractional digits and a trailing Z.
    expect(row.written_at_utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    // Explicitly NOT the machine-paced filename stamp (yyyymmdd-hhmmss-fff-utc), which the old ZIP engine
    // used — that form has no 'T', no ':' and no trailing 'Z'.
    expect(row.written_at_utc).not.toMatch(/^\d{8}-\d{6}/)
    expect(row.written_at_utc).not.toContain('-utc')
    // And it must parse back to a real instant.
    expect(Number.isNaN(Date.parse(row.written_at_utc))).toBe(false)
  })

  it('dedups: an unchanged re-save writes no new row (compared to the latest row for that path)', () => {
    const target = path.join(tmpRoot, 'config.json')
    const bytes = Buffer.from('{"a":1}', 'utf-8')

    record(target, bytes)
    record(target, Buffer.from('{"a":1}', 'utf-8')) // identical content, distinct buffer instance
    record(target, bytes)
    closeBackupStore()

    const rows = readAllRows(storeFile)
    expect(rows).toHaveLength(1)
  })

  it('a changed save inserts a new row, and a revert to earlier content inserts another', () => {
    const target = path.join(tmpRoot, 'config.json')
    const v1 = Buffer.from('{"v":1}', 'utf-8')
    const v2 = Buffer.from('{"v":2}', 'utf-8')

    record(target, v1) // insert (first version)
    record(target, v2) // insert (changed)
    record(target, v1) // insert (revert differs from the immediately preceding row, so it is recorded)
    closeBackupStore()

    const rows = readAllRows(storeFile)
    expect(rows).toHaveLength(3)
    expect(Buffer.from(rows[0].content).equals(v1)).toBe(true)
    expect(Buffer.from(rows[1].content).equals(v2)).toBe(true)
    expect(Buffer.from(rows[2].content).equals(v1)).toBe(true) // the revert, recorded as its own version
    // Dedup is per-path against the LATEST row only, so the revert is not collapsed into row 0.
    expect(rows[0].content_sha256).toBe(rows[2].content_sha256)
  })

  it('dedups per path independently — two files each keep their own latest-row comparison', () => {
    const a = path.join(tmpRoot, 'config.json')
    const b = path.join(tmpRoot, 'elaborators.json')
    const same = Buffer.from('shared-bytes', 'utf-8')

    record(a, same)
    record(b, same) // same content, different path → a distinct row, not deduped against a's row
    record(a, same) // unchanged for a → deduped
    record(b, same) // unchanged for b → deduped
    closeBackupStore()

    const rows = readAllRows(storeFile)
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.path))).toEqual(new Set([a, b]))
  })

  it('is best-effort: a store failure is caught, logged once at warn, never thrown, and the save is unaffected', () => {
    const warn = vi.spyOn(logger, 'log')

    // Force the store's open to fail by putting a DIRECTORY where backups.sqlite3 must be a file — the
    // first ensureOpen() will throw, log ONE warn, and disable recording for the session.
    fs.mkdirSync(storeFile, { recursive: true })

    const savedFile = path.join(tmpRoot, 'config.json')
    // The "save" the app performs is independent of the record — simulate it landing on disk first.
    fs.writeFileSync(savedFile, '{"saved":true}')

    // record() must not throw even though the store cannot open.
    expect(() => record(savedFile, Buffer.from('{"saved":true}'))).not.toThrow()
    // A subsequent record in the same session must also not throw and must not re-log (open is not retried).
    expect(() => record(savedFile, Buffer.from('{"saved":true}'))).not.toThrow()

    // The save is completely unaffected — the file the app wrote is exactly what it wrote.
    expect(fs.readFileSync(savedFile, 'utf-8')).toBe('{"saved":true}')

    // Exactly one warn line, naming the failure — never an error, never a flood.
    const warnCalls = warn.mock.calls.filter((c) => c[0] === 'warn')
    expect(warnCalls).toHaveLength(1)
    expect(warnCalls[0][1]).toContain('backup store')
    expect(warn.mock.calls.some((c) => c[0] === 'error')).toBe(false)
  })

  it('an insert failure on an already-open store is caught and logged once at warn, without throwing', () => {
    const warn = vi.spyOn(logger, 'log')
    const target = path.join(tmpRoot, 'config.json')

    // Open the store cleanly with one successful record.
    record(target, Buffer.from('{"n":1}', 'utf-8'))
    expect(warn.mock.calls.some((c) => c[0] === 'warn')).toBe(false)

    // Now break the open store: replace prepare() with one that throws, simulating a locked DB / disk-full
    // insert failure that surfaces after a healthy open.
    const spy = vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(() => {
      throw new Error('database is locked')
    })

    // A changed content would normally insert; the throw must be swallowed.
    expect(() => record(target, Buffer.from('{"n":2}', 'utf-8'))).not.toThrow()
    spy.mockRestore()

    const warnCalls = warn.mock.calls.filter((c) => c[0] === 'warn')
    expect(warnCalls).toHaveLength(1)
    expect(warnCalls[0][1]).toContain('failed to record')
  })
})
