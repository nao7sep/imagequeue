import fs from 'fs'

/** Sync directory metadata after an atomic rename where the platform exposes
 * directory handles. Windows does not, so the rename itself is its durability
 * boundary there. */
export async function syncDirectoryAsync(directory: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await fs.promises.open(directory, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Sync file metadata without blocking Electron's event loop. */
export async function syncFileAsync(file: string): Promise<void> {
  const handle = await fs.promises.open(file, 'r')
  try { await handle.sync() } finally { await handle.close() }
}
