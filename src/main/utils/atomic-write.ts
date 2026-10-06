import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import { record } from '../backup/backup-store'
import { syncDirectory, syncDirectoryAsync } from './fsync'
import { holdsBytes, holdsBytesAsync } from './holds-bytes'

// Writes data to filePath atomically via temp file + rename. On POSIX the
// rename is atomic; on Windows it is atomic as long as the target file
// already exists, which it always does after the first successful write.
//
// This prevents the "process killed mid-write leaves a truncated/partial
// file" failure mode that would otherwise cause the next load to throw on
// JSON.parse and silently fall back to defaults.
//
// The temp file is named `<stem>-<nanoid>.tmp` (the target's filename minus
// its extension, plus a random discriminator) and lives in the same directory
// as the target — the storage-path conventions' derived-filename grammar,
// never a dot-appended `<file>.tmp`.
//
// This module is the single managed-text atomic-write choke point and —
// crucially — the ONE place the data-backup hook lives (data-backup
// conventions). A managed-text write that bypasses these sync/async helpers is
// a silent backup gap. The only other staged writers are api-keys-store,
// which is a SECRET and never recorded, and the generated-output and export
// writers, which publish binary output the user harvests through the staging
// helpers below.
//
// `records` is the per-write-site record/no-record decision, made at authoring
// time by the caller that knows what the file IS (data-backup conventions:
// "'Excluded' is a property of the code path"). When true, the exact bytes just
// written are recorded into ~/.imagequeue/backups.sqlite3 STRICTLY AFTER the
// rename lands. Recording before the rename would risk a "backup of a save that
// never happened": if the rename then failed, the history would hold a version
// that never reached disk. So: rename lands, THEN record the same bytes already
// in hand — never a re-read of the file. The record is best-effort and silent;
// it never throws back into this write and never affects the save's success
// (see backup/backup-store.ts).
// A replacement keeps the file's permission mode (content-lifecycle conventions,
// "A replace keeps what it can"). Node has no portable call that carries
// extended attributes or Finder tags, so those are not copied; the file's times
// are the new content's own and are never carried over.
function keptMode(target: fs.Stats): number {
  return target.mode & 0o7777
}

/** The staging name beside a file: `<stem>-<nanoid>.tmp` in its own directory. */
export function stagingPathFor(filePath: string): string {
  const stem = path.basename(filePath, path.extname(filePath))
  return path.join(path.dirname(filePath), `${stem}-${nanoid()}.tmp`)
}

/** Writes and syncs complete bytes to a fresh staging file beside filePath, for
 * a caller that publishes it itself; on failure the staging file is removed. */
export function stageBeside(filePath: string, bytes: NodeJS.ArrayBufferView): string {
  const tempPath = stagingPathFor(filePath)
  try {
    const fd = fs.openSync(tempPath, 'wx')
    try {
      fs.writeFileSync(fd, bytes)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  } catch (error) {
    fs.rmSync(tempPath, { force: true })
    throw error
  }
  return tempPath
}

/** Publishes complete staged bytes under destination without replacing a file
 * already there (storage-path conventions, "A publish that must not overwrite
 * claims the final name exclusively"): a hard link, or an exclusive copy on a
 * volume without hard links. False when the name is taken. */
export function claimFinalName(staging: string, destination: string): boolean {
  try {
    fs.linkSync(staging, destination)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? ''
    if (code === 'EEXIST') return false
    if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV'].includes(code)) throw error
  }
  try {
    fs.copyFileSync(staging, destination, fs.constants.COPYFILE_EXCL)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    fs.rmSync(destination, { force: true })
    throw error
  }
}

export function writeFileAtomic(
  filePath: string,
  data: string | NodeJS.ArrayBufferView,
  records: boolean
): void {
  const dir = path.dirname(filePath)
  const stem = path.basename(filePath, path.extname(filePath))
  const tempPath = path.join(dir, `${stem}-${nanoid()}.tmp`)
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf-8') : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  if (holdsBytes(filePath, bytes)) return
  try {
    const fd = fs.openSync(tempPath, 'w')
    try {
      fs.writeFileSync(fd, bytes)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    const target = fs.statSync(filePath, { throwIfNoEntry: false })
    if (target) fs.chmodSync(tempPath, keptMode(target))
    fs.renameSync(tempPath, filePath)
    syncDirectory(dir)
    // After the rename: the file is exactly where it belongs, so record the bytes
    // we just wrote. Best-effort — record() catches, logs once, and swallows every
    // failure, so a backup problem can never break the save that already succeeded.
    if (records) record(filePath, bytes)
  } finally {
    // The path no longer exists after publication. On every pre-publication
    // failure this removes the unique staging file without masking the cause.
    try {
      fs.rmSync(tempPath, { force: true })
    } catch {
      // Cleanup is best-effort; the original write/publish error is authoritative.
    }
  }
}

export function writeJsonAtomic(filePath: string, value: unknown, records: boolean): void {
  writeFileAtomic(filePath, JSON.stringify(value, null, 2), records)
}

/** Async managed-text publication for user-waiting acquisition paths. Writes in
 * cancellable chunks, syncs staged bytes, checks cancellation immediately before
 * rename, syncs the destination directory, and removes staging on every unwind. */
export async function writeFileAtomicAsync(
  filePath: string,
  data: string | NodeJS.ArrayBufferView,
  records: boolean,
  signal?: AbortSignal
): Promise<void> {
  const dir = path.dirname(filePath)
  const stem = path.basename(filePath, path.extname(filePath))
  const tempPath = path.join(dir, `${stem}-${nanoid()}.tmp`)
  const bytes = typeof data === 'string'
    ? Buffer.from(data, 'utf-8')
    : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  let handle: fs.promises.FileHandle | null = null
  try {
    signal?.throwIfAborted()
    if (await holdsBytesAsync(filePath, bytes)) return
    handle = await fs.promises.open(tempPath, 'w')
    const chunkSize = 1024 * 1024
    let offset = 0
    while (offset < bytes.length) {
      signal?.throwIfAborted()
      const length = Math.min(chunkSize, bytes.length - offset)
      const { bytesWritten } = await handle.write(bytes, offset, length, offset)
      if (bytesWritten <= 0) throw new Error('Atomic staging write made no progress')
      offset += bytesWritten
    }
    await handle.sync()
    await handle.close()
    handle = null
    const target = await fs.promises.stat(filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (target) await fs.promises.chmod(tempPath, keptMode(target))
    signal?.throwIfAborted()
    await fs.promises.rename(tempPath, filePath)
    await syncDirectoryAsync(dir)
    if (records) record(filePath, bytes)
  } finally {
    await handle?.close().catch(() => undefined)
    await fs.promises.rm(tempPath, { force: true }).catch(() => undefined)
  }
}
