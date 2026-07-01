import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runBackup } from '../../../src/main/backup/backup-engine'
import type { BackupIndex } from '../../../src/main/backup/backup-types'

const ENV_VAR = 'IMAGEQUEUE_HOME'
const original = process.env[ENV_VAR]

let home: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-backup-'))
  process.env[ENV_VAR] = home
})

afterEach(() => {
  if (original === undefined) delete process.env[ENV_VAR]
  else process.env[ENV_VAR] = original
  fs.rmSync(home, { recursive: true, force: true })
})

function write(relative: string, contents: string): void {
  const full = path.join(home, relative)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, contents)
}

function backupsDir(): string {
  return path.join(home, 'backups')
}

function readIndex(): BackupIndex {
  return JSON.parse(fs.readFileSync(path.join(backupsDir(), 'index.json'), 'utf-8')) as BackupIndex
}

function listArchives(): string[] {
  if (!fs.existsSync(backupsDir())) return []
  return fs.readdirSync(backupsDir()).filter((n) => n.startsWith('backup-') && n.endsWith('.zip'))
}

// Reads the entry names stored in a zip by scanning local file headers (PK\x03\x04). Good enough for the
// small text files these tests archive; avoids adding a zip-reader dependency.
function archiveEntryNames(zipPath: string): string[] {
  const buf = fs.readFileSync(zipPath)
  const names: string[] = []
  for (let i = 0; i + 30 <= buf.length; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      const nameLen = buf.readUInt16LE(i + 26)
      const extraLen = buf.readUInt16LE(i + 28)
      const name = buf.toString('utf-8', i + 30, i + 30 + nameLen)
      names.push(name)
      i += 30 + nameLen + extraLen - 1
    }
  }
  return names
}

describe('runBackup (engine over a temp home)', () => {
  it('first run captures the durable managed files and writes an index object', async () => {
    write('config.json', '{"a":1}')
    write('api-keys.json', 'secret')
    write('elaborators.json', '[]')
    write('params.json', '{}')

    const report = await runBackup(new Date(Date.UTC(2026, 6, 1, 1, 0, 0)))

    expect(report.fatal).toBeUndefined()
    expect(report.nothingChanged).toBe(false)
    expect(report.indexWasReset).toBe(false)
    expect(report.filesArchived).toBe(3)

    const archives = listArchives()
    expect(archives).toEqual(['backup-20260701-010000-utc.zip'])

    const names = archiveEntryNames(path.join(backupsDir(), archives[0]))
    // api-keys.json (a secret) is excluded; only the durable managed files are captured.
    expect(names.sort()).toEqual(['config.json', 'elaborators.json', 'params.json'])
    expect(names).not.toContain('api-keys.json')

    // The index is the { entries: [...] } object shape, not a bare array.
    const idx = readIndex()
    expect(Array.isArray(idx)).toBe(false)
    expect(Array.isArray(idx.entries)).toBe(true)
    expect(idx.entries).toHaveLength(3)
    const entry = idx.entries.find((e) => e.archivePath === 'config.json')!
    expect(Object.keys(entry)).toEqual(['archivedAt', 'archivePath', 'sizeBytes', 'lastWriteUtc'])
    expect(entry.archivedAt).toBe('20260701-010000-utc')
  })

  it('excludes output/, bin/, models/, temp/, dependencies.json, api-keys.json, and *.invalid', async () => {
    write('config.json', '{"a":1}')
    write('output/20260701-000000-utc/session.json', '{}')
    write('output/20260701-000000-utc/image-1.png', 'PNGDATA')
    write('output/20260701-000000-utc/session.log', 'log')
    write('bin/draw-things', 'ELF')
    write('models/weights.bin', 'WEIGHTS')
    write('temp/scratch.dat', 'scratch')
    write('dependencies.json', '{"cache":true}')
    write('api-keys.json', 'secret')
    write('api-keys.json.20260701-000000-utc.invalid', 'quarantined')

    const report = await runBackup(new Date(Date.UTC(2026, 6, 1, 1, 0, 0)))
    expect(report.filesArchived).toBe(1)

    const names = archiveEntryNames(path.join(backupsDir(), listArchives()[0]))
    expect(names).toEqual(['config.json'])
    // Explicitly assert the excluded output/ tree is NOT in the archive.
    expect(names.some((n) => n.startsWith('output/'))).toBe(false)
    expect(names).not.toContain('bin/draw-things')
    expect(names).not.toContain('models/weights.bin')
    expect(names).not.toContain('temp/scratch.dat')
    expect(names).not.toContain('dependencies.json')
    // Secrets and quarantined-aside files are excluded too.
    expect(names).not.toContain('api-keys.json')
    expect(names).not.toContain('api-keys.json.20260701-000000-utc.invalid')

    // The index never records an excluded path either.
    expect(readIndex().entries.map((e) => e.archivePath)).toEqual(['config.json'])
  })

  it('writes nothing on a second run when nothing changed', async () => {
    write('config.json', '{"a":1}')
    await runBackup(new Date(Date.UTC(2026, 6, 1, 1, 0, 0)))

    const report = await runBackup(new Date(Date.UTC(2026, 6, 1, 2, 0, 0)))
    expect(report.nothingChanged).toBe(true)
    expect(report.filesArchived).toBe(0)
    // Still exactly one archive from the first run.
    expect(listArchives()).toHaveLength(1)
    expect(readIndex().entries).toHaveLength(1)
  })

  it('captures only the changed file on the next run', async () => {
    write('config.json', '{"a":1}')
    write('params.json', '{"p":1}')
    await runBackup(new Date(Date.UTC(2026, 6, 1, 1, 0, 0)))

    // Change one file; give it an mtime well past the recorded one.
    const later = new Date(Date.UTC(2026, 6, 2, 0, 0, 0))
    write('params.json', '{"p":2,"more":true}')
    fs.utimesSync(path.join(home, 'params.json'), later, later)

    const report = await runBackup(new Date(Date.UTC(2026, 6, 3, 0, 0, 0)))
    expect(report.nothingChanged).toBe(false)
    expect(report.filesArchived).toBe(1)

    const names = archiveEntryNames(path.join(backupsDir(), 'backup-20260703-000000-utc.zip'))
    expect(names).toEqual(['params.json'])
    // The index now has two records for params.json (both runs) and one for config.json.
    const entries = readIndex().entries
    expect(entries.filter((e) => e.archivePath === 'params.json')).toHaveLength(2)
    expect(entries.filter((e) => e.archivePath === 'config.json')).toHaveLength(1)
  })

  it('resets a corrupt index and does a full backup', async () => {
    write('config.json', '{"a":1}')
    fs.mkdirSync(backupsDir(), { recursive: true })
    fs.writeFileSync(path.join(backupsDir(), 'index.json'), 'not json {{{')

    const report = await runBackup(new Date(Date.UTC(2026, 6, 1, 1, 0, 0)))
    expect(report.indexWasReset).toBe(true)
    expect(report.nothingChanged).toBe(false)
    expect(report.filesArchived).toBe(1)
    expect(readIndex().entries).toHaveLength(1)
  })

  // POSIX-only: an unreadable subdirectory becomes a logged skip while the rest of the tree is still
  // captured. Skipped when running as root (chmod 0000 does not deny root) or on Windows.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'records a skip for an unreadable directory and still captures the rest',
    async () => {
      write('config.json', '{"a":1}')
      const dead = path.join(home, 'locked')
      fs.mkdirSync(dead)
      write('locked/inside.json', '{}')
      fs.chmodSync(dead, 0o000)

      const report = await runBackup(new Date(Date.UTC(2026, 6, 1, 1, 0, 0)))
      fs.chmodSync(dead, 0o700) // restore so afterEach can clean up

      expect(report.skips.some((s) => s.path === dead)).toBe(true)
      // config.json is still captured despite the skip.
      expect(report.filesArchived).toBe(1)
      const names = archiveEntryNames(path.join(backupsDir(), listArchives()[0]))
      expect(names).toEqual(['config.json'])
    }
  )
})
