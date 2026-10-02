import fs from 'fs'

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
