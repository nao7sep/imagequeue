import fs from 'fs'

/** Sync file metadata without blocking Electron's event loop. */
export async function syncFileAsync(file: string): Promise<void> {
  const handle = await fs.promises.open(file, 'r')
  try { await handle.sync() } finally { await handle.close() }
}
