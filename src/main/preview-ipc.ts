import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { getSessionDir } from './session'
import { ImageExt } from './utils/file-output'

// IPC handler for loading image data for preview display.
// Returns the base64-encoded bytes and the extension of the file that was
// actually found on disk, so the renderer can build a correctly-typed data URL.
export function registerPreviewIpc(): void {
  ipcMain.handle('preview:getImage', (_event, baseName: string): { data: string; ext: ImageExt } | null => {
    const dir = getSessionDir()

    for (const ext of ['png', 'jpg', 'webp'] as const) {
      const imagePath = path.join(dir, `${baseName}.${ext}`)
      if (fs.existsSync(imagePath)) {
        return { data: fs.readFileSync(imagePath).toString('base64'), ext }
      }
    }

    return null
  })

  ipcMain.handle('preview:getMetadata', (_event, baseName: string) => {
    const dir = getSessionDir()
    const metaPath = path.join(dir, `${baseName}.json`)

    if (!fs.existsSync(metaPath)) return null

    const raw = fs.readFileSync(metaPath, 'utf-8')
    return JSON.parse(raw)
  })
}
