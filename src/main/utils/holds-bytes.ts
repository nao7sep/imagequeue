import fs from 'fs'

// A write that changes nothing is skipped (content-lifecycle conventions), so
// the file's times, its backups and sync see only real changes.
export async function holdsBytesAsync(filePath: string, bytes: Buffer): Promise<boolean> {
  try {
    return (await fs.promises.readFile(filePath)).equals(bytes)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
