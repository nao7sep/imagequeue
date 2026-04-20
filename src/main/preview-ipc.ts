import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { getSessionDir } from './session'

// IPC handler for loading image data for preview display.
export function registerPreviewIpc(): void {
  ipcMain.handle('preview:getImage', (_event, baseName: string) => {
    const dir = getSessionDir()
    const imagePath = path.join(dir, `${baseName}.png`)

    if (!fs.existsSync(imagePath)) return null

    const buffer = fs.readFileSync(imagePath)
    return buffer.toString('base64')
  })

  ipcMain.handle('preview:getMetadata', (_event, baseName: string) => {
    const dir = getSessionDir()
    const metaPath = path.join(dir, `${baseName}.json`)

    if (!fs.existsSync(metaPath)) return null

    const raw = fs.readFileSync(metaPath, 'utf-8')
    return JSON.parse(raw)
  })
}
