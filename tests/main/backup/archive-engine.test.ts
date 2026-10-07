import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { archiveStores, clearAbandonedRun, runArchiveSession, type ArchiveManifest } from '../../../src/main/backup/archive-engine'
import { getArchivedStores } from '../../../src/main/config/storage-root'
import * as fsync from '../../../src/main/utils/fsync'
import { archivesToThin } from '../../../src/main/backup/archive-thinning'
import { FORMAT_VERSIONS } from '../../../src/main/store-format'

describe('binary-store archive', () => {
  let root: string
  let database: DatabaseSync
  const directory = () => path.join(root, 'backups')
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
  it('deduplicates unchanged snapshots and thins older archives by age when it writes one', async () => {
    await archiveStores(root, getArchivedStores(root), time)
    await archiveStores(root, getArchivedStores(root), new Date(time.getTime() + 1000))
    expect(archives()).toHaveLength(1)
    const first = fs.readFileSync(path.join(directory(), archives()[0]))
    for (const name of ['20260801-090000-000-utc.zip', '20260801-180000-000-utc.zip', '20260925-090000-000-utc.zip', '20260925-180000-000-utc.zip']) {
      fs.writeFileSync(path.join(directory(), name), first)
    }
    database.exec("INSERT INTO concepts VALUES ('changed')")
    await archiveStores(root, getArchivedStores(root), new Date(time.getTime() + 2000))
    expect(archives()).toEqual([
      '20260801-180000-000-utc.zip', '20260925-090000-000-utc.zip', '20260925-180000-000-utc.zip',
      '20261001-100000-000-utc.zip', '20261001-100002-000-utc.zip',
    ])
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
  it.each(['missing', 'unreadable'])('writes no archive when every declared store is %s', async (state) => {
    database.close()
    const store = getArchivedStores(root)[0]
    fs.rmSync(store.path)
    if (state === 'unreadable') fs.writeFileSync(store.path, 'not a database')

    await runArchiveSession('begin', root, getArchivedStores(root))
    const result = await runArchiveSession('finish', root, getArchivedStores(root))

    expect(result.archivePath).toBeUndefined()
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].path).toBe(store.path)
    expect(fs.readdirSync(directory())).toEqual([])
    if (state === 'missing') expect(fs.existsSync(store.path)).toBe(false)
  })
  it('skips a held exclusive lock with one warning and leaves the owner intact', async () => {
    fs.mkdirSync(directory(), { recursive: true })
    fs.writeFileSync(path.join(directory(), '.lock'), String(process.pid))
    const result = await archiveStores(root, getArchivedStores(root), time)
    expect(result.archivePath).toBeUndefined()
    expect(result.warnings).toEqual([{ path: path.join(directory(), '.lock'), error: expect.objectContaining({ message: 'Archive skipped: the lock is held by another run' }) }])
    expect(archives()).toEqual([])
    expect(fs.readFileSync(path.join(directory(), '.lock'), 'utf8')).toBe(String(process.pid))
  })
  it('clears the lock and temporary files a run of this process left at its deadline', async () => {
    fs.mkdirSync(directory(), { recursive: true })
    fs.writeFileSync(path.join(directory(), '.lock'), String(process.pid))
    fs.writeFileSync(path.join(directory(), 'snapshot-abc.tmp'), 'partial')
    fs.writeFileSync(path.join(directory(), 'archive-def.tmp'), 'partial')
    fs.writeFileSync(path.join(directory(), '20260101-000000-000-utc.zip'), 'kept')
    await clearAbandonedRun(root)
    expect(fs.readdirSync(directory())).toEqual(['20260101-000000-000-utc.zip'])
    expect((await archiveStores(root, getArchivedStores(root), time)).archivePath).toBeDefined()
  })
  it('leaves a lock another process holds, and its temporary files, alone', async () => {
    fs.mkdirSync(directory(), { recursive: true })
    fs.writeFileSync(path.join(directory(), '.lock'), String(process.pid + 1))
    fs.writeFileSync(path.join(directory(), 'snapshot-abc.tmp'), 'partial')
    await clearAbandonedRun(root)
    expect(fs.readdirSync(directory()).sort()).toEqual(['.lock', 'snapshot-abc.tmp'])
    fs.rmSync(directory(), { recursive: true })
    await expect(clearAbandonedRun(root)).resolves.toBeUndefined()
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
  it.each(['link', 'copy'] as const)('retains the published %s archive path after directory sync fails', async (publication) => {
    if (publication === 'copy') {
      vi.spyOn(fs, 'linkSync').mockImplementationOnce(() => {
        throw Object.assign(new Error('Hard links unsupported'), { code: 'ENOTSUP' })
      })
    }
    const failure = new Error('Directory sync failed')
    vi.spyOn(fsync, 'syncDirectory').mockImplementationOnce(() => { throw failure })

    const result = await archiveStores(root, getArchivedStores(root), time)

    expect(result.archivePath).toBe(path.join(directory(), '20261001-100000-000-utc.zip'))
    const contents = unzipSync(fs.readFileSync(result.archivePath!))
    expect(contents['concepts.sqlite3']).toBeDefined()
    expect(JSON.parse(strFromU8(contents['manifest.json']))).toMatchObject({ writtenAtUtc: time.toISOString() })
    expect(result.warnings).toEqual([{ path: directory(), error: expect.objectContaining({ message: failure.message }) }])
    expect(fs.readdirSync(directory())).toEqual([path.basename(result.archivePath!)])
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
  // Rewrites an archive's manifest through `edit`, keeping its other entries.
  function rewriteManifest(archive: string, edit: (manifest: Record<string, unknown>) => Record<string, unknown>): void {
    const contents = unzipSync(fs.readFileSync(archive))
    contents['manifest.json'] = strToU8(JSON.stringify(edit(JSON.parse(strFromU8(contents['manifest.json'])))))
    fs.writeFileSync(archive, zipSync(contents))
  }
  it('writes the manifest format version first', async () => {
    const result = await archiveStores(root, getArchivedStores(root), time)
    const manifest = JSON.parse(strFromU8(unzipSync(fs.readFileSync(result.archivePath!))['manifest.json']))
    expect(Object.entries(manifest)[0]).toEqual(['formatVersion', FORMAT_VERSIONS.backupManifest])
  })
  it('treats a previous manifest with no format version as unreadable and archives anew', async () => {
    const first = await archiveStores(root, getArchivedStores(root), time)
    rewriteManifest(first.archivePath!, ({ formatVersion: _formatVersion, ...rest }) => rest)
    const next = await archiveStores(root, getArchivedStores(root), new Date(time.getTime() + 1000))
    expect(next.warnings).toHaveLength(1)
    expect(next.archivePath).toBeDefined()
    expect(archives()).toHaveLength(2)
  })
  it('writes and thins nothing beside an archive from a newer version, and leaves its bytes as they were', async () => {
    const first = await archiveStores(root, getArchivedStores(root), time)
    fs.copyFileSync(first.archivePath!, path.join(directory(), '20260801-090000-000-utc.zip'))
    rewriteManifest(first.archivePath!, (manifest) => ({ ...manifest, formatVersion: FORMAT_VERSIONS.backupManifest + 1 }))
    const bytes = fs.readFileSync(first.archivePath!)
    database.exec("INSERT INTO concepts VALUES ('changed')")
    const next = await archiveStores(root, getArchivedStores(root), new Date(time.getTime() + 1000))
    expect(next.warnings).toHaveLength(1)
    expect(next.archivePath).toBeUndefined()
    expect(archives()).toEqual(['20260801-090000-000-utc.zip', path.basename(first.archivePath!)])
    expect(fs.readFileSync(first.archivePath!).equals(bytes)).toBe(true)
  })
  it.each([
    'newer', 'invalid zip', 'missing manifest', 'invalid JSON', 'missing marker',
    'invalid time', 'invalid entries', 'invalid entry', 'invalid optional field',
  ])('preserves and names an actual %s retention candidate while thinning supported peers', async (problem) => {
    const first = await archiveStores(root, getArchivedStores(root), time)
    const original = fs.readFileSync(first.archivePath!)
    const candidateName = '20260801-090000-000-utc.zip'
    const supportedName = '20260801-080000-000-utc.zip'
    const keptName = '20260801-180000-000-utc.zip'
    const candidate = path.join(directory(), candidateName)
    for (const name of [candidateName, supportedName, keptName]) fs.writeFileSync(path.join(directory(), name), original)
    if (problem === 'invalid zip') fs.writeFileSync(candidate, 'invalid zip')
    else if (problem === 'missing manifest') fs.writeFileSync(candidate, zipSync({ 'concepts.sqlite3': new Uint8Array([1]) }))
    else if (problem === 'invalid JSON') fs.writeFileSync(candidate, zipSync({ 'manifest.json': strToU8('{ invalid') }))
    else rewriteManifest(candidate, (manifest) => {
      if (problem === 'newer') return { ...manifest, formatVersion: FORMAT_VERSIONS.backupManifest + 1 }
      if (problem === 'missing marker') {
        const { formatVersion: _version, ...rest } = manifest
        return rest
      }
      if (problem === 'invalid time') return { ...manifest, writtenAtUtc: 'invalid' }
      if (problem === 'invalid entries') return { ...manifest, entries: {} }
      if (problem === 'invalid entry') return { ...manifest, entries: [{ path: 3, entryName: 'concepts.sqlite3' }] }
      return { ...manifest, entries: [{ path: '/concepts.sqlite3', entryName: 'concepts.sqlite3', skipped: 3 }] }
    })
    const bytes = fs.readFileSync(candidate)
    expect(archivesToThin(archives(), time)).toEqual(expect.arrayContaining([candidateName, supportedName]))
    database.exec("INSERT INTO concepts VALUES ('changed')")

    const result = await archiveStores(root, getArchivedStores(root), new Date(time.getTime() + 1000))

    expect(result.archivePath).toBeDefined()
    expect(fs.existsSync(result.archivePath!)).toBe(true)
    expect(result.warnings).toEqual([{ path: candidate, error: expect.objectContaining({ message: expect.any(String) }) }])
    if (problem === 'newer') expect(result.warnings[0].error).toMatchObject({ name: 'NewerFormatError' })
    expect(fs.readFileSync(candidate)).toEqual(bytes)
    expect(fs.existsSync(path.join(directory(), supportedName))).toBe(false)
    expect(fs.readFileSync(path.join(directory(), keptName))).toEqual(original)
  })

  it('reports archive failures without escaping into startup or quit', async () => {
    vi.spyOn(fs, 'mkdirSync').mockImplementationOnce(() => { throw new Error('full') })
    const result = await runArchiveSession('begin', root, getArchivedStores(root))
    expect(result.warnings).toHaveLength(1)
  })
})
