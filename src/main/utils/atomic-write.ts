import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import { record } from '../backup/backup-store'

/** Sync directory metadata after an atomic rename where the platform exposes
 * directory handles. Windows does not, so the rename itself is its durability
 * boundary there. */
export function syncDirectory(directory: string): void {
  if (process.platform === 'win32') return
  const fd = fs.openSync(directory, 'r')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

export async function syncDirectoryAsync(directory: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await fs.promises.open(directory, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export function syncFile(filePath: string): void {
  const fd = fs.openSync(filePath, 'r')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

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
// a silent backup gap. The only other temp+rename writers are api-keys-store,
// which is a SECRET and never recorded, and file-output, which writes binary
// output the user harvests.
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
export function writeFileAtomic(
  filePath: string,
  data: string | NodeJS.ArrayBufferView,
  records: boolean
): void {
  const dir = path.dirname(filePath)
  const stem = path.basename(filePath, path.extname(filePath))
  const tempPath = path.join(dir, `${stem}-${nanoid()}.tmp`)
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf-8') : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  try {
    const fd = fs.openSync(tempPath, 'w')
    try {
      fs.writeFileSync(fd, bytes)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
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
    signal?.throwIfAborted()
    await fs.promises.rename(tempPath, filePath)
    await syncDirectoryAsync(dir)
    if (records) record(filePath, bytes)
  } finally {
    await handle?.close().catch(() => undefined)
    await fs.promises.rm(tempPath, { force: true }).catch(() => undefined)
  }
}
