import fs from 'fs'
import path from 'path'
import { shell } from 'electron'
import { getSessionDir } from '../session'
import { BackendId } from '../../shared/types'
import { ImageMetadata } from './image-metadata'

export type ImageExt = 'png' | 'jpg' | 'webp'

// Returns the ImageExt parsed from a stored image path (e.g. "foo.png" → "png"),
// or null when the suffix is missing or unrecognized.
export function imageExtFromPath(imagePath: string | null | undefined): ImageExt | null {
  if (!imagePath) return null
  const dot = imagePath.lastIndexOf('.')
  if (dot < 0) return null
  const suffix = imagePath.slice(dot + 1).toLowerCase()
  if (suffix === 'png' || suffix === 'jpg' || suffix === 'webp') return suffix
  return null
}

// Composes the base filename (without extension) for an output. The ordinal
// disambiguates multiple outputs that landed in the same second; ordinal 0 (the
// first of its second) gets no suffix so the common case stays
// `{timestamp}-utc-{slug}-{backend}`, and later ones get a `-2`, `-3`, … tail
// after the backend so the front timestamp token stays intact.
export function outputBaseName(
  timestamp: string,
  ordinal: number,
  slug: string,
  backend: BackendId
): string {
  const suffix = ordinal > 0 ? `-${ordinal + 1}` : ''
  return `${timestamp}-utc-${slug}-${backend}${suffix}`
}

// Writes the image file and its JSON sidecar to the session directory.
// Returns the base filename (without extension).
export function writeImageOutput(
  timestamp: string,
  ordinal: number,
  slug: string,
  backend: BackendId,
  imageBuffer: Buffer,
  metadata: ImageMetadata,
  ext: ImageExt
): string {
  const baseName = outputBaseName(timestamp, ordinal, slug, backend)
  const dir = getSessionDir()
  fs.mkdirSync(dir, { recursive: true })

  const imagePath = path.join(dir, `${baseName}.${ext}`)
  const metaPath = path.join(dir, `${baseName}.json`)

  if (fs.existsSync(imagePath) || fs.existsSync(metaPath)) {
    throw new Error(`Refusing to overwrite existing output files for ${baseName}`)
  }

  fs.writeFileSync(imagePath, imageBuffer)
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8')

  return baseName
}

// Deletes both the image and metadata files for a given base filename.
export function deleteImageOutput(baseName: string, ext: ImageExt): void {
  const dir = getSessionDir()
  const imagePath = path.join(dir, `${baseName}.${ext}`)
  const metaPath = path.join(dir, `${baseName}.json`)

  if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath)
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath)
}

// Moves the image and metadata files for a given base filename to the OS trash.
export async function trashImageOutput(baseName: string, ext: ImageExt): Promise<void> {
  const dir = getSessionDir()
  const imagePath = path.join(dir, `${baseName}.${ext}`)
  const metaPath = path.join(dir, `${baseName}.json`)

  if (fs.existsSync(imagePath)) await shell.trashItem(imagePath)
  if (fs.existsSync(metaPath)) await shell.trashItem(metaPath)
}
