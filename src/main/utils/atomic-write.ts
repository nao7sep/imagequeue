import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import { record } from '../backup/backup-store'

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
// This is the single managed-text atomic-write choke point, and — crucially —
// the ONE place the data-backup hook lives (data-backup conventions). A
// managed-text write that bypasses this helper is a silent backup gap; there is
// deliberately no second managed-text atomic-write path in the app (the only
// other temp+rename writers are api-keys-store, which is a SECRET and never
// recorded, and file-output, which writes binary output the user harvests).
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
  fs.writeFileSync(tempPath, bytes)
  fs.renameSync(tempPath, filePath)
  // After the rename: the file is exactly where it belongs, so record the bytes
  // we just wrote. Best-effort — record() catches, logs once, and swallows every
  // failure, so a backup problem can never break the save that already succeeded.
  if (records) record(filePath, bytes)
}

export function writeJsonAtomic(filePath: string, value: unknown, records: boolean): void {
  writeFileAtomic(filePath, JSON.stringify(value, null, 2), records)
}
