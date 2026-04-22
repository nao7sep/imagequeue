import fs from 'fs'
import path from 'path'
import { getSessionDir } from '../session'
import { BackendId } from '../../shared/types'
import { ImageMetadata } from './image-metadata'

export type ImageExt = 'png' | 'jpg' | 'webp'

// Writes the image file and its JSON sidecar to the session directory.
// Returns the base filename (without extension).
export function writeImageOutput(
  timestamp: string,
  slug: string,
  backend: BackendId,
  imageBuffer: Buffer,
  metadata: ImageMetadata,
  ext: ImageExt = 'png'
): string {
  const baseName = `${timestamp}-utc-${slug}-${backend}`
  const dir = getSessionDir()

  const imagePath = path.join(dir, `${baseName}.${ext}`)
  const metaPath = path.join(dir, `${baseName}.json`)

  fs.writeFileSync(imagePath, imageBuffer)
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8')

  return baseName
}

// Deletes both the image and metadata files for a given base filename.
export function deleteImageOutput(baseName: string, ext: ImageExt = 'png'): void {
  const dir = getSessionDir()
  const imagePath = path.join(dir, `${baseName}.${ext}`)
  const metaPath = path.join(dir, `${baseName}.json`)

  if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath)
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath)
}
