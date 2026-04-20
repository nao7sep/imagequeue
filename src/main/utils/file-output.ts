import fs from 'fs'
import path from 'path'
import { getSessionDir } from '../session'
import { ImageMetadata } from './image-metadata'

export type BackendName = 'openai' | 'google' | 'flux' | 'local'

// Writes the image file and its JSON sidecar to the session directory.
// Returns the base filename (without extension).
export function writeImageOutput(
  timestamp: string,
  slug: string,
  backend: BackendName,
  imageBuffer: Buffer,
  metadata: ImageMetadata
): string {
  const baseName = `${timestamp}-utc-${slug}-${backend}`
  const dir = getSessionDir()

  const imagePath = path.join(dir, `${baseName}.png`)
  const metaPath = path.join(dir, `${baseName}.json`)

  fs.writeFileSync(imagePath, imageBuffer)
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8')

  return baseName
}

// Deletes both the image and metadata files for a given base filename.
export function deleteImageOutput(baseName: string): void {
  const dir = getSessionDir()
  const imagePath = path.join(dir, `${baseName}.png`)
  const metaPath = path.join(dir, `${baseName}.json`)

  if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath)
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath)
}
