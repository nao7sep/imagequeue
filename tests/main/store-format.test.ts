import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { checkHeader, FILE_WRITER, MissingHeaderError, NewerFormatError, openSqliteStore, withHeader, type FileFormat } from '../../src/main/store-format'
import { header, headerSql } from './file-header'

const TEST: FileFormat = { kind: 'testStore', version: 1 }

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function file(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-sqlite-admission-'))
  roots.push(root)
  return path.join(root, 'store.sqlite3')
}

it('preserves a store from a newer version', () => {
  const name = file()
  const original = new DatabaseSync(name)
  original.exec(headerSql(TEST, 2))
  original.close()
  const bytes = fs.readFileSync(name)
  expect(() => openSqliteStore(name, TEST, 'CREATE TABLE values_kept (value TEXT)')).toThrow(NewerFormatError)
  expect(fs.readFileSync(name)).toEqual(bytes)
})

it('preserves a populated store with no file header', () => {
  const name = file()
  const original = new DatabaseSync(name)
  original.exec("CREATE TABLE values_kept (value TEXT); INSERT INTO values_kept VALUES ('kept')")
  original.close()
  const bytes = fs.readFileSync(name)
  expect(() => openSqliteStore(name, TEST, 'CREATE TABLE values_kept (value TEXT)')).toThrow(MissingHeaderError)
  expect(fs.readFileSync(name)).toEqual(bytes)
})

// An interrupted first creation leaves either an empty file or a database with
// no schema, and neither may disable the store for good.
it.each([
  ['an empty file', (name: string) => fs.writeFileSync(name, '')],
  ['a database with no schema', (name: string) => { const db = new DatabaseSync(name); db.exec('PRAGMA journal_mode = WAL'); db.close() }],
])('initializes %s left by an interrupted first creation', (_state, leave) => {
  const name = file()
  leave(name)
  const store = openSqliteStore(name, TEST, 'CREATE TABLE kept (value TEXT)')
  try {
    expect(store.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 })
    expect(store.prepare("SELECT name FROM sqlite_master WHERE name = 'kept'").all()).toEqual([{ name: 'kept' }])
  } finally { store.close() }
})

it('opens its own current store again without change', () => {
  const name = file()
  const first = openSqliteStore(name, TEST, 'CREATE TABLE kept (value TEXT)')
  first.exec("INSERT INTO kept VALUES ('row')")
  first.close()
  const again = openSqliteStore(name, TEST, 'CREATE TABLE IF NOT EXISTS kept (value TEXT)')
  try { expect(again.prepare('SELECT value FROM kept').all()).toEqual([{ value: 'row' }]) }
  finally { again.close() }
})

it.skipIf(process.platform === 'win32')('creates an ordinary database with normal filesystem permissions', () => {
  const name = file()
  const store = openSqliteStore(name, TEST, 'CREATE TABLE kept (value TEXT)')
  try { expect(fs.statSync(name).mode & 0o777).toBe(0o666 & ~process.umask()) }
  finally { store.close() }
})

it('rolls back schema and marker together after failed initialization', () => {
  const name = file()
  expect(() => openSqliteStore(name, TEST, 'CREATE TABLE partial (value TEXT); INVALID SQL')).toThrow()
  const reader = new DatabaseSync(name)
  try {
    expect(reader.prepare('PRAGMA user_version').get()).toEqual({ user_version: 0 })
    expect(reader.prepare("SELECT name FROM sqlite_master WHERE name = 'partial'").all()).toEqual([])
  } finally { reader.close() }
})

it.each([
  ['no file_header table', 'CREATE TABLE kept (value TEXT); PRAGMA user_version = 1'],
  ['another owner', `CREATE TABLE kept (value TEXT); ${headerSql(TEST, 1, 'otherapp')}`],
  ['another kind', `CREATE TABLE kept (value TEXT); ${headerSql({ kind: 'otherKind', version: 1 })}`],
  ['another owner at a newer version', `CREATE TABLE kept (value TEXT); ${headerSql(TEST, 2, 'otherapp')}`],
])('refuses a marked store with %s as unreadable, leaving its bytes as they were', (_state, sql) => {
  const name = file()
  const original = new DatabaseSync(name)
  original.exec(sql)
  original.close()
  const bytes = fs.readFileSync(name)
  expect(() => openSqliteStore(name, TEST, 'CREATE TABLE IF NOT EXISTS kept (value TEXT)')).toThrow(MissingHeaderError)
  expect(fs.readFileSync(name)).toEqual(bytes)
})

it('writes the header into a new store and rewrites only the writer rows on each open', () => {
  const name = file()
  const seeded = new DatabaseSync(name)
  seeded.exec(`CREATE TABLE kept (value TEXT); ${headerSql(TEST)} INSERT INTO file_header VALUES ('writer.caller.name', 'old')`)
  seeded.close()
  const store = openSqliteStore(name, TEST, 'CREATE TABLE IF NOT EXISTS kept (value TEXT)')
  try {
    expect(Object.fromEntries((store.prepare('SELECT key, value FROM file_header').all() as { key: string; value: string }[]).map((row) => [row.key, row.value]))).toEqual({
      'format.owner': 'imagequeue', 'format.kind': 'testStore', 'writer.name': FILE_WRITER.name, 'writer.version': FILE_WRITER.version,
    })
  } finally { store.close() }
})

describe('the JSON header', () => {
  it('writes format and writer first, then the content', () => {
    expect(Object.keys(withHeader({ value: 1 }, TEST))).toEqual(['format', 'writer', 'value'])
    expect(withHeader({ value: 1 }, TEST)).toEqual({ ...header(TEST), value: 1 })
  })

  it('returns the content without the header', () => {
    expect(checkHeader({ ...header(TEST), value: 1 }, TEST, 'x.json')).toEqual({ value: 1 })
  })

  it.each([
    ['a writer of any shape', { writer: 'anything' }],
    ['no writer', { writer: undefined }],
  ])('ignores %s', (_state, writer) => {
    expect(checkHeader({ ...header(TEST), ...writer, value: 1 }, TEST, 'x.json')).toEqual({ value: 1 })
  })

  it.each([
    ['no header', { value: 1 }],
    ['a format that is not an object', { format: 1 }],
    ['another owner', { format: { owner: 'otherapp', kind: 'testStore', version: 1 } }],
    ['another kind', { format: { owner: 'imagequeue', kind: 'config', version: 1 } }],
    ['another owner at a newer version', { format: { owner: 'otherapp', kind: 'testStore', version: 2 } }],
    ['a version that is not an integer', { format: { owner: 'imagequeue', kind: 'testStore', version: '1' } }],
    ['version 0', { format: { owner: 'imagequeue', kind: 'testStore', version: 0 } }],
    ['an old formatVersion marker', { formatVersion: 1 }],
  ])('reads a file with %s as unreadable', (_state, map) => {
    expect(() => checkHeader(map, TEST, 'x.json')).toThrow(Error)
    expect(() => checkHeader(map, TEST, 'x.json')).not.toThrow(NewerFormatError)
  })

  it('reads a newer version of its own format as newer', () => {
    expect(() => checkHeader({ ...header(TEST, 2) }, TEST, 'x.json')).toThrow(NewerFormatError)
  })
})
