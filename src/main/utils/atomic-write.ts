import fs from 'fs'

// Writes JSON to filePath atomically via temp file + rename. On POSIX the
// rename is atomic; on Windows it is atomic as long as the target file
// already exists, which it always does after the first successful write.
//
// This prevents the "process killed mid-write leaves a truncated/partial
// JSON file" failure mode that would otherwise cause the next load to
// throw on JSON.parse and silently fall back to defaults.
export function writeJsonAtomic(filePath: string, value: unknown): void {
  const tempPath = `${filePath}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf-8')
  fs.renameSync(tempPath, filePath)
}
