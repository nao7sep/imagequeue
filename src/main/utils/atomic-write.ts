import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'

// Writes JSON to filePath atomically via temp file + rename. On POSIX the
// rename is atomic; on Windows it is atomic as long as the target file
// already exists, which it always does after the first successful write.
//
// This prevents the "process killed mid-write leaves a truncated/partial
// JSON file" failure mode that would otherwise cause the next load to
// throw on JSON.parse and silently fall back to defaults.
//
// The temp file is named `<stem>-<nanoid>.tmp` (the target's filename minus
// its extension, plus a random discriminator) and lives in the same directory
// as the target — the filename-conventions' derived-filename grammar, never a
// dot-appended `<file>.tmp`.
export function writeFileAtomic(filePath: string, data: string | NodeJS.ArrayBufferView): void {
  const dir = path.dirname(filePath)
  const stem = path.basename(filePath, path.extname(filePath))
  const tempPath = path.join(dir, `${stem}-${nanoid()}.tmp`)
  fs.writeFileSync(tempPath, data)
  fs.renameSync(tempPath, filePath)
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
  writeFileAtomic(filePath, JSON.stringify(value, null, 2))
}
