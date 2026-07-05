/**
 * Runs one backup pass and returns a {@link BackupReport}. It never throws for an expected problem (a
 * fatal error is captured in the report) and never logs — the caller logs the report. See the data-backup
 * conventions: change is size + mtime, the archive mirrors `~/.imagequeue/`, and the archive is written
 * and renamed into place *before* the index so a crash never records a phantom backup.
 */
import fs from 'fs'
import { createWriteStream } from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import yazl from 'yazl'
import { nanoid } from 'nanoid'
import { writeFileAtomic } from '../utils/atomic-write'
import { getBackupIndexPath, getBackupsDir } from './backup-paths'
import { collectRoots } from './backup-collector'
import { selectChanged } from './backup-plan'
import { formatArchivedAt, toIsoSeconds } from './backup-time'
import type { BackupCandidate, BackupIndex, BackupReport, BackupSkip } from './backup-types'

/** Captures everything changed since the last run. `now` is a parameter so the archive stamp is
 *  deterministic under test. */
export async function runBackup(now: Date): Promise<BackupReport> {
  try {
    return await runCore(now)
  } catch (fatal) {
    return { nothingChanged: false, filesArchived: 0, skips: [], indexWasReset: false, fatal }
  }
}

async function runCore(now: Date): Promise<BackupReport> {
  const { index, indexWasReset } = await loadIndex()
  const { candidates, skips } = await collectRoots()

  const changed = selectChanged(candidates, index)
  if (changed.length === 0) {
    return { nothingChanged: true, filesArchived: 0, skips, indexWasReset }
  }

  const written = await writeArchive(now, changed, skips)
  if (written.archived.length === 0) {
    // Every changed file vanished before it could be archived; nothing was written, nothing is recorded.
    return { nothingChanged: true, filesArchived: 0, skips, indexWasReset }
  }

  for (const item of written.archived) {
    index.entries.push({
      archivedAt: written.archivedAt,
      archivePath: item.archivePath,
      sizeBytes: item.sizeBytes,
      lastWriteUtc: toIsoSeconds(item.mtimeMs),
    })
  }
  // Index second: the archive is already in place, so a crash here just re-captures next run.
  const indexPath = getBackupIndexPath()
  writeFileAtomic(indexPath, `${JSON.stringify(index, null, 2)}\n`)

  return {
    nothingChanged: false,
    archiveFileName: written.archiveFileName,
    filesArchived: written.archived.length,
    skips,
    indexWasReset,
  }
}

async function loadIndex(): Promise<{ index: BackupIndex; indexWasReset: boolean }> {
  const indexPath = getBackupIndexPath()
  let raw: string
  try {
    raw = await fs.promises.readFile(indexPath, 'utf-8')
  } catch (err) {
    // Absent index (first run, or freshly relocated root) is normal: back up everything.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { index: { entries: [] }, indexWasReset: false }
    }
    // Unreadable for another reason — treat as reset (full backup) rather than fail the run.
    return { index: { entries: [] }, indexWasReset: true }
  }

  try {
    const parsed = JSON.parse(raw) as BackupIndex
    if (!parsed || !Array.isArray(parsed.entries)) throw new Error('malformed index')
    return { index: { entries: parsed.entries }, indexWasReset: false }
  } catch {
    // A corrupt index is deleted and treated as empty: the run becomes a full backup, costing one
    // redundant archive, never data.
    await tryDelete(indexPath)
    return { index: { entries: [] }, indexWasReset: true }
  }
}

/** Streams the changed files to a temp zip, then renames it into place as a no-clobber create: right
 *  before the final move, if `backup-<archivedAt>.zip` is already taken (a second instance stamped the
 *  same millisecond), the stamp advances to the next free millisecond and that stamp wins — for both the
 *  zip name and the index records the caller writes. Returns the files actually archived (a file that
 *  vanished since collection is skipped, not recorded) together with the winning stamp and archive name. */
async function writeArchive(
  now: Date,
  changed: readonly BackupCandidate[],
  skips: BackupSkip[]
): Promise<{ archived: BackupCandidate[]; archivedAt: string; archiveFileName: string }> {
  const dir = await ensureBackupsDir()
  const initialArchivedAt = formatArchivedAt(now)
  // `<stem>-<nanoid>.tmp`, same directory as the target archive.
  const tempPath = path.join(dir, `backup-${initialArchivedAt}-${nanoid()}.tmp`)

  const zip = new yazl.ZipFile()
  const archived: BackupCandidate[] = []
  for (const item of changed) {
    if (!fs.existsSync(item.sourcePath)) {
      skips.push({ path: item.archivePath, reason: 'vanished before archive' })
      continue
    }
    zip.addFile(item.sourcePath, item.archivePath)
    archived.push(item)
  }
  if (archived.length === 0) {
    return { archived, archivedAt: initialArchivedAt, archiveFileName: `backup-${initialArchivedAt}.zip` }
  }

  zip.end()
  try {
    await pipeline(zip.outputStream, createWriteStream(tempPath))
    const { archivedAt, archiveFileName, finalPath } = reserveArchiveName(dir, now)
    await fs.promises.rename(tempPath, finalPath)
    return { archived, archivedAt, archiveFileName }
  } catch (err) {
    await tryDelete(tempPath)
    throw err
  }
}

/** Finds the next free `backup-<archivedAt>.zip` name in `dir`, starting at `now`'s millisecond and
 *  advancing one millisecond at a time (keeping the same `Date` instant, reformatted) until the name is
 *  unused. This is the no-clobber create the data-backup conventions require: two runs that stamp the
 *  same millisecond never overwrite each other's archive. */
function reserveArchiveName(
  dir: string,
  now: Date
): { archivedAt: string; archiveFileName: string; finalPath: string } {
  let instant = now
  for (;;) {
    const archivedAt = formatArchivedAt(instant)
    const archiveFileName = `backup-${archivedAt}.zip`
    const finalPath = path.join(dir, archiveFileName)
    if (!fs.existsSync(finalPath)) {
      return { archivedAt, archiveFileName, finalPath }
    }
    instant = new Date(instant.getTime() + 1)
  }
}

async function ensureBackupsDir(): Promise<string> {
  const dir = getBackupsDir()
  await fs.promises.mkdir(dir, { recursive: true })
  return dir
}

async function tryDelete(target: string): Promise<void> {
  try {
    await fs.promises.rm(target, { force: true })
  } catch {
    // best effort: a leftover temp is harmless and lives under the excluded backups/ directory
  }
}
