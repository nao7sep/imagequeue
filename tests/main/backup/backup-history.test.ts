import fs from 'fs'
import os from 'os'
import path from 'path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openBackupHistory, recordVersion } from '../../../src/main/backup/backup-history'
import { FILE_FORMATS, MissingHeaderError, NewerFormatError } from '../../../src/main/store-format'
import { headerSql } from '../file-header'

// The history itself (data-backup-conventions): the last version of each
// protected file saved in each launch, as the exact bytes written.

interface Row {
  id: number
  session_id: string | null
  path: string
  content: Uint8Array
  content_sha256: string
  byte_size: number
  written_at_utc: string
}

describe('backup history', () => {
  let root: string
  let file: string
  const open: DatabaseSync[] = []

  function history(): DatabaseSync {
    const db = openBackupHistory(file)
    open.push(db)
    return db
  }
  function rows(): Row[] {
    for (const db of open.splice(0)) db.close()
    const db = new DatabaseSync(file, { readOnly: true })
    try {
      return db.prepare('SELECT * FROM backups ORDER BY id').all() as unknown as Row[]
    } finally {
      db.close()
    }
  }
  function userVersion(): number {
    const db = new DatabaseSync(file, { readOnly: true })
    try {
      return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    } finally {
      db.close()
    }
  }
  const target = () => path.join(root, 'config.json')

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-history-'))
    file = path.join(root, 'backups.sqlite3')
  })
  afterEach(() => {
    for (const db of open.splice(0)) db.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('keeps the exact bytes written: a BOM, CR/LF and non-UTF-8 bytes survive verbatim', () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('one\r\ntwo'), Buffer.from([0xff, 0x00, 0xfe])])
    recordVersion(history(), 'launch-a', target(), bytes)
    const [row] = rows()
    expect(row.path).toBe(target())
    expect(Buffer.from(row.content).equals(bytes)).toBe(true)
    expect(row.byte_size).toBe(bytes.byteLength)
    expect(row.content_sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(row.written_at_utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('keeps one row per file per launch, holding the launch\'s last save', () => {
    const db = history()
    recordVersion(db, 'launch-a', target(), Buffer.from('{"v":1}'))
    recordVersion(db, 'launch-a', target(), Buffer.from('{"v":2}'))
    recordVersion(db, 'launch-a', target(), Buffer.from('{"v":3}'))
    const kept = rows()
    expect(kept).toHaveLength(1)
    expect(kept[0].session_id).toBe('launch-a')
    expect(Buffer.from(kept[0].content).toString()).toBe('{"v":3}')
  })

  it('writes nothing for a launch whose first save equals the latest version, and a row once it differs', () => {
    recordVersion(history(), 'launch-a', target(), Buffer.from('{"v":1}'))
    const db = history()
    recordVersion(db, 'launch-b', target(), Buffer.from('{"v":1}'))
    expect(rows()).toHaveLength(1)
    recordVersion(history(), 'launch-b', target(), Buffer.from('{"v":2}'))
    expect(rows().map((row) => row.session_id)).toEqual(['launch-a', 'launch-b'])
  })

  it('keeps each file\'s rows apart', () => {
    const db = history()
    recordVersion(db, 'launch-a', target(), Buffer.from('same'))
    recordVersion(db, 'launch-a', path.join(root, 'elaborators.json'), Buffer.from('same'))
    expect(rows().map((row) => path.basename(row.path))).toEqual(['config.json', 'elaborators.json'])
  })

  it('initializes an empty version-0 store at the current version', () => {
    new DatabaseSync(file).close()
    expect(userVersion()).toBe(0)
    history()
    rows()
    expect(userVersion()).toBe(FILE_FORMATS.backups.version)
  })

  it('refuses a populated file that is not a backup history, leaving its bytes as they were', () => {
    const seeded = new DatabaseSync(file)
    seeded.exec('CREATE TABLE kept (value TEXT)')
    seeded.close()
    const bytes = fs.readFileSync(file)
    expect(() => history()).toThrow(MissingHeaderError)
    expect(fs.readFileSync(file).equals(bytes)).toBe(true)
  })

  it('refuses a store from a newer version, leaving its bytes as they were', () => {
    const seeded = new DatabaseSync(file)
    seeded.exec(`CREATE TABLE backups (id INTEGER PRIMARY KEY); ${headerSql(FILE_FORMATS.backups, FILE_FORMATS.backups.version + 1)}`)
    seeded.close()
    const bytes = fs.readFileSync(file)
    expect(() => history()).toThrow(NewerFormatError)
    expect(fs.readFileSync(file).equals(bytes)).toBe(true)
  })
})
