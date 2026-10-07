import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { openSqliteStore, sqliteStoreOperation } from '../../src/main/store-format'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function file(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-sqlite-admission-'))
  roots.push(root)
  return path.join(root, 'store.sqlite3')
}

it.each([0, -1, 2])('preserves an existing unsupported empty SQLite store at version %s', (version) => {
  const name = file()
  const original = new DatabaseSync(name)
  original.exec(`PRAGMA user_version = ${version}`)
  original.close()
  const bytes = fs.readFileSync(name)
  expect(() => openSqliteStore(name, 1, 'CREATE TABLE values_kept (value TEXT)')).toThrow()
  expect(fs.readFileSync(name)).toEqual(bytes)
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

it('refuses a cached writer and reader after another connection upgrades the marker', () => {
  const name = file()
  const store = openSqliteStore(name, 1, 'CREATE TABLE kept (value TEXT)')
  const upgrader = new DatabaseSync(name)
  try {
    upgrader.exec('PRAGMA user_version = 2')
    expect(() => sqliteStoreOperation(store, 1, name, true, () => store.exec("INSERT INTO kept VALUES ('lost')"))).toThrow()
    expect(() => sqliteStoreOperation(store, 1, name, false, () => store.prepare('SELECT * FROM kept').all())).toThrow()
    expect(upgrader.prepare('SELECT * FROM kept').all()).toEqual([])
  } finally { upgrader.close(); store.close() }
})
