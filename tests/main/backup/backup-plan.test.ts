import { describe, expect, it } from 'vitest'
import { MTIME_MATCH_TOLERANCE_MS, selectChanged } from '../../../src/main/backup/backup-plan'
import { isExcludedDir, isExcludedFile } from '../../../src/main/backup/home-root-exclusions'
import { formatArchivedAt, toIsoSeconds, truncateToSecondMs } from '../../../src/main/backup/backup-time'
import type { BackupCandidate, BackupIndex } from '../../../src/main/backup/backup-types'

function candidate(over: Partial<BackupCandidate> = {}): BackupCandidate {
  return {
    sourcePath: '/abs/config.json',
    archivePath: 'config.json',
    sizeBytes: 100,
    mtimeMs: Date.parse('2026-07-01T00:00:00Z'),
    ...over,
  }
}

function index(...entries: BackupIndex['entries']): BackupIndex {
  return { entries }
}

describe('selectChanged (pure change decision)', () => {
  it('captures a candidate with no prior entry', () => {
    expect(selectChanged([candidate()], index())).toHaveLength(1)
  })

  it('skips a candidate whose size and mtime match the latest entry', () => {
    const c = candidate()
    const idx = index({
      archivedAt: '20260630-000000-utc',
      archivePath: c.archivePath,
      sizeBytes: c.sizeBytes,
      lastWriteUtc: toIsoSeconds(c.mtimeMs),
    })
    expect(selectChanged([c], idx)).toHaveLength(0)
  })

  it('captures a candidate whose size differs', () => {
    const c = candidate({ sizeBytes: 200 })
    const idx = index({
      archivedAt: '20260630-000000-utc',
      archivePath: c.archivePath,
      sizeBytes: 100,
      lastWriteUtc: toIsoSeconds(c.mtimeMs),
    })
    expect(selectChanged([c], idx)).toHaveLength(1)
  })

  it('captures a candidate whose mtime moved beyond the tolerance', () => {
    const base = Date.parse('2026-07-01T00:00:00Z')
    const c = candidate({ mtimeMs: base + MTIME_MATCH_TOLERANCE_MS + 1000 })
    const idx = index({
      archivedAt: '20260630-000000-utc',
      archivePath: c.archivePath,
      sizeBytes: c.sizeBytes,
      lastWriteUtc: toIsoSeconds(base),
    })
    expect(selectChanged([c], idx)).toHaveLength(1)
  })

  it('treats an mtime within the 2s tolerance as unchanged', () => {
    const base = Date.parse('2026-07-01T00:00:00Z')
    const c = candidate({ mtimeMs: base + MTIME_MATCH_TOLERANCE_MS })
    const idx = index({
      archivedAt: '20260630-000000-utc',
      archivePath: c.archivePath,
      sizeBytes: c.sizeBytes,
      lastWriteUtc: toIsoSeconds(base),
    })
    expect(selectChanged([c], idx)).toHaveLength(0)
  })

  it('uses the latest entry per path by archivedAt lexical order', () => {
    const c = candidate()
    const idx = index(
      {
        archivedAt: '20260601-000000-utc',
        archivePath: c.archivePath,
        sizeBytes: 999, // stale, would look changed
        lastWriteUtc: toIsoSeconds(c.mtimeMs),
      },
      {
        archivedAt: '20260630-000000-utc',
        archivePath: c.archivePath,
        sizeBytes: c.sizeBytes, // latest matches
        lastWriteUtc: toIsoSeconds(c.mtimeMs),
      }
    )
    expect(selectChanged([c], idx)).toHaveLength(0)
  })

  it('recaptures when the stored timestamp is unparseable', () => {
    const c = candidate()
    const idx = index({
      archivedAt: '20260630-000000-utc',
      archivePath: c.archivePath,
      sizeBytes: c.sizeBytes,
      lastWriteUtc: 'not-a-date',
    })
    expect(selectChanged([c], idx)).toHaveLength(1)
  })
})

describe('home-root exclusions', () => {
  it('backs up the four managed files', () => {
    expect(isExcludedFile('config.json')).toBe(false)
    expect(isExcludedFile('api-keys.json')).toBe(false)
    expect(isExcludedFile('elaborators.json')).toBe(false)
    expect(isExcludedFile('params.json')).toBe(false)
  })

  it('excludes the entire output/ directory and everything under it', () => {
    expect(isExcludedDir('output')).toBe(true)
    expect(isExcludedFile('output')).toBe(true)
    expect(isExcludedFile('output/20260701-000000-utc/session.json')).toBe(true)
    expect(isExcludedFile('output/20260701-000000-utc/image-1.png')).toBe(true)
    expect(isExcludedFile('output/20260701-000000-utc/session.log')).toBe(true)
  })

  it('excludes the re-fetchable / scratch / weights directories', () => {
    for (const dir of ['bin', 'temp', 'models', 'logs', 'backups']) {
      expect(isExcludedDir(dir)).toBe(true)
      expect(isExcludedFile(`${dir}/anything.bin`)).toBe(true)
    }
  })

  it('excludes the dependency cache file but not other json', () => {
    expect(isExcludedFile('dependencies.json')).toBe(true)
    expect(isExcludedFile('config.json')).toBe(false)
  })

  it('excludes *.tmp atomic-write temporaries', () => {
    expect(isExcludedFile('config.json.tmp')).toBe(true)
    expect(isExcludedFile('foo/bar.TMP')).toBe(true)
  })

  it('excludes OS/file-manager noise case-insensitively at any depth', () => {
    expect(isExcludedFile('.DS_Store')).toBe(true)
    expect(isExcludedFile('.ds_store')).toBe(true)
    expect(isExcludedFile('Thumbs.db')).toBe(true)
    expect(isExcludedFile('desktop.ini')).toBe(true)
    expect(isExcludedFile('Desktop.INI')).toBe(true)
    expect(isExcludedFile('nested/dir/DESKTOP.INI')).toBe(true)
    expect(isExcludedFile('nested/dir/.DS_Store')).toBe(true)
  })

  it('does not prune ordinary subdirectories', () => {
    expect(isExcludedDir('somewhere')).toBe(false)
    expect(isExcludedFile('somewhere/data.json')).toBe(false)
  })
})

describe('backup time helpers', () => {
  it('formats a whole-second UTC ISO stamp with no fractional part', () => {
    const ms = Date.UTC(2026, 6, 1, 2, 22, 20)
    expect(toIsoSeconds(ms)).toBe('2026-07-01T02:22:20Z')
    expect(toIsoSeconds(ms + 999)).toBe('2026-07-01T02:22:20Z')
  })

  it('truncates epoch ms to the whole second', () => {
    expect(truncateToSecondMs(1751336540999)).toBe(1751336540000)
  })

  it('formats the archivedAt run stamp as yyyymmdd-hhmmss-utc', () => {
    expect(formatArchivedAt(new Date(Date.UTC(2026, 6, 1, 2, 22, 20)))).toBe('20260701-022220-utc')
  })
})
