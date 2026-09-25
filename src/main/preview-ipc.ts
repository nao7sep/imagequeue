import { handle } from './ipc-boundary'
import fs from 'fs'
import path from 'path'
import { getSessionDir } from './session'
import { ImageExt, assertSafeBaseName } from './utils/file-output'

async function readImageFromDir(dir: string, baseName: string): Promise<{ data: string; ext: ImageExt } | null> {
  for (const ext of ['png', 'jpg', 'webp'] as const) {
    try {
      const bytes = await fs.promises.readFile(path.join(dir, `${baseName}.${ext}`))
      return { data: bytes.toString('base64'), ext }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  return null
}

// IPC handler for the selected image's full bytes: the preview pane and the
// fullscreen viewer take it as a data URL. Lists and thumbnails do not come
// through here; they load from the iq-image: scheme (image-protocol.ts).
// Returns the base64-encoded bytes and the extension of the file that was
// actually found on disk, so the renderer can build a correctly-typed data URL.
export function registerPreviewIpc(): void {
  handle('preview:getImage', (_event, baseName: string): Promise<{ data: string; ext: ImageExt } | null> => {
    return readImageFromDir(getSessionDir(), assertSafeBaseName(baseName))
  })
}
