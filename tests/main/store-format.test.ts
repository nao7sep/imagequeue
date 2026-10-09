import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { MissingFormatError, NewerFormatError, openSqliteStore } from '../../src/main/store-format'

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
  original.exec('PRAGMA user_version = 2')
  original.close()
  const bytes = fs.readFileSync(name)
  expect(() => openSqliteStore(name, 1, 'CREATE TABLE values_kept (value TEXT)')).toThrow(NewerFormatError)
  expect(fs.readFileSync(name)).toEqual(bytes)
})

it('preserves a populated store with no format version', () => {
  const name = file()
  const original = new DatabaseSync(name)
  original.exec("CREATE TABLE values_kept (value TEXT); INSERT INTO values_kept VALUES ('kept')")
  original.close()
  const bytes = fs.readFileSync(name)
  expect(() => openSqliteStore(name, 1, 'CREATE TABLE values_kept (value TEXT)')).toThrow(MissingFormatError)
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
  const store = openSqliteStore(name, 1, 'CREATE TABLE kept (value TEXT)')
  try {
    expect(store.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 })
    expect(store.prepare("SELECT name FROM sqlite_master WHERE name = 'kept'").all()).toEqual([{ name: 'kept' }])
  } finally { store.close() }
})

it('opens its own current store again without change', () => {
  const name = file()
  const first = openSqliteStore(name, 1, 'CREATE TABLE kept (value TEXT)')
  first.exec("INSERT INTO kept VALUES ('row')")
  first.close()
  const again = openSqliteStore(name, 1, 'CREATE TABLE IF NOT EXISTS kept (value TEXT)')
  try { expect(again.prepare('SELECT value FROM kept').all()).toEqual([{ value: 'row' }]) }
  finally { again.close() }
})

it.skipIf(process.platform === 'win32')('creates an ordinary database with normal filesystem permissions', () => {
  const name = file()
  const store = openSqliteStore(name, 1, 'CREATE TABLE kept (value TEXT)')
  try { expect(fs.statSync(name).mode & 0o777).toBe(0o666 & ~process.umask()) }
  finally { store.close() }
})

it('rolls back schema and marker together after failed initialization', () => {
  const name = file()
  expect(() => openSqliteStore(name, 1, 'CREATE TABLE partial (value TEXT); INVALID SQL')).toThrow()
  const reader = new DatabaseSync(name)
  try {
    expect(reader.prepare('PRAGMA user_version').get()).toEqual({ user_version: 0 })
    expect(reader.prepare("SELECT name FROM sqlite_master WHERE name = 'partial'").all()).toEqual([])
  } finally { reader.close() }
})
