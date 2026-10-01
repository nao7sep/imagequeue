import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { unzipSync, strFromU8 } from 'fflate'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { archiveStores, runArchiveSession, type ArchiveManifest } from '../../../src/main/backup/archive-engine'
import { getArchivedStores } from '../../../src/main/config/storage-root'

describe('binary-store archive', () => {
  let root: string
  let database: DatabaseSync
  const directory = () => path.join(root, 'backups', 'archives')
  const archives = () => fs.readdirSync(directory()).filter((name) => name.endsWith('.zip')).sort()
  const time = new Date('2026-10-01T10:00:00.000Z')
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-archive-'))
    database = new DatabaseSync(path.join(root, 'concepts.sqlite3'))
    database.exec('PRAGMA journal_mode=WAL; CREATE TABLE concepts (value TEXT); INSERT INTO concepts VALUES (\'first\')')
  })
  afterEach(() => {
    if (database.isOpen) database.close()
    vi.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true })
  })
  it('snapshots SQLite including WAL bytes, with hashes of the copied bytes and a UTC manifest', async () => {
    const result = await archiveStores(root, getArchivedStores(root), time)
    expect(result.warnings).toEqual([])
    const contents = unzipSync(fs.readFileSync(result.archivePath!))
    expect(Object.keys(contents).sort()).toEqual(['concepts.sqlite3', 'manifest.json'])
    const manifest = JSON.parse(strFromU8(contents['manifest.json'])) as ArchiveManifest
    expect(manifest.writtenAtUtc).toBe(time.toISOString())
    expect(manifest.entries).toEqual([{ ...getArchivedStores(root)[0], sha256: createHash('sha256').update(contents['concepts.sqlite3']).digest('hex') }])
    const snapshot = path.join(root, 'restored.sqlite3')
    fs.writeFileSync(snapshot, contents['concepts.sqlite3'])
    const restored = new DatabaseSync(snapshot)
    expect(restored.prepare('SELECT value FROM concepts').get()).toMatchObject({ value: 'first' })
    restored.close()
    expect(fs.existsSync(path.join(directory(), '.lock'))).toBe(false)
    expect(fs.readdirSync(directory()).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
  it('deduplicates unchanged snapshots and keeps the newest ten changed archives', async () => {
    await archiveStores(root, getArchivedStores(root), time)
    await archiveStores(root, getArchivedStores(root), new Date(time.getTime() + 1000))
    expect(archives()).toHaveLength(1)
    const first = fs.readFileSync(path.join(directory(), archives()[0]))
    for (let i = 1; i <= 11; i++) {
      fs.writeFileSync(path.join(directory(), `20261001-0900${String(i).padStart(2, '0')}-000-utc.zip`), first)
    }
    database.exec("INSERT INTO concepts VALUES ('changed')")
    await archiveStores(root, getArchivedStores(root), new Date(time.getTime() + 2000))
    expect(archives()).toHaveLength(10)
    expect(archives()[0]).toBe('20261001-090004-000-utc.zip')
  })
  it('skips an unreadable store while keeping readable stores and the reason in the manifest', async () => {
    const stores = [...getArchivedStores(root), { path: path.join(root, 'missing.sqlite3'), entryName: 'missing.sqlite3' }]
    const result = await archiveStores(root, stores, time)
    expect(result.warnings).toHaveLength(1)
    const files = unzipSync(fs.readFileSync(result.archivePath!))
    const manifest = JSON.parse(strFromU8(files['manifest.json'])) as ArchiveManifest
    expect(manifest.entries[1].skipped).toEqual(expect.any(String))
    expect(files['concepts.sqlite3']).toBeDefined()
    expect(files['missing.sqlite3']).toBeUndefined()
  })
  it('skips a held exclusive lock and leaves the owner intact', async () => {
    fs.mkdirSync(directory(), { recursive: true })
    fs.writeFileSync(path.join(directory(), '.lock'), String(process.pid))
    const result = await archiveStores(root, getArchivedStores(root), time)
    expect(result.archivePath).toBeUndefined()
    expect(archives()).toEqual([])
    expect(fs.readFileSync(path.join(directory(), '.lock'), 'utf8')).toBe(String(process.pid))
  })
  it('marks first launch without archiving, and archives clean exit after stores are closed', async () => {
    await runArchiveSession('begin', root, getArchivedStores(root))
    expect(archives()).toEqual([])
    expect(fs.existsSync(path.join(directory(), '.running'))).toBe(true)
    database.close()
    await runArchiveSession('finish', root, getArchivedStores(root))
    expect(archives()).toHaveLength(1)
    expect(fs.existsSync(path.join(directory(), '.running'))).toBe(false)
  })
  it('archives an unclean previous run at startup before a new store is opened', async () => {
    await runArchiveSession('begin', root, getArchivedStores(root))
    database.close()
    await runArchiveSession('begin', root, getArchivedStores(root))
    expect(archives()).toHaveLength(1)
    expect(fs.existsSync(path.join(directory(), '.running'))).toBe(true)
  })
  it('recovers a lock stranded before its owner was recorded on an unclean exit', async () => {
    await runArchiveSession('begin', root, getArchivedStores(root))
    fs.writeFileSync(path.join(directory(), '.lock'), '')
    database.close()
    await runArchiveSession('begin', root, getArchivedStores(root))
    expect(archives()).toHaveLength(1)
    expect(fs.existsSync(path.join(directory(), '.lock'))).toBe(false)
  })
  it('keeps archiving when the previous archive manifest is unreadable', async () => {
    const first = await archiveStores(root, getArchivedStores(root), time)
    fs.writeFileSync(first.archivePath!, 'invalid zip')
    const next = await archiveStores(root, getArchivedStores(root), new Date(time.getTime() + 1000))
    expect(next.warnings).toHaveLength(1)
    expect(next.archivePath).toBeDefined()
    expect(archives()).toHaveLength(2)
  })
  it('does not replace an archive when the clock gives the same filename', async () => {
    const result = await archiveStores(root, getArchivedStores(root), time)
    const original = fs.readFileSync(result.archivePath!)
    database.exec("INSERT INTO concepts VALUES ('next')")
    const second = await archiveStores(root, getArchivedStores(root), time)
    expect(second.warnings).toHaveLength(1)
    expect(fs.readFileSync(result.archivePath!)).toEqual(original)
    expect(fs.readdirSync(directory()).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
  it('reports archive failures without escaping into startup or quit', async () => {
    vi.spyOn(fs, 'mkdirSync').mockImplementationOnce(() => { throw new Error('full') })
    const result = await runArchiveSession('begin', root, getArchivedStores(root))
    expect(result.warnings).toHaveLength(1)
  })
})
