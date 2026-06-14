import fs from 'fs'
import path from 'path'
import { shell } from 'electron'
import { getSessionDir } from '../session'
import { BackendId } from '../../shared/types'
import { ImageMetadata } from './image-metadata'
import { log } from '../logger'

export type ImageExt = 'png' | 'jpg' | 'webp'

// Guards a renderer-supplied output base name before it is joined into a session
// path. Output base names are always bare file stems (no directory part), so any
// separator or `..` is a path-traversal attempt — reject it rather than read or
// reveal a file outside the session dir. Mirrors the session-id guard in
// session/state.ts.
export function assertSafeBaseName(baseName: unknown): string {
  if (
    typeof baseName !== 'string' ||
    baseName.length === 0 ||
    baseName.includes('/') ||
    baseName.includes('\\') ||
    baseName.includes('..') ||
    baseName.includes('\0') ||
    path.basename(baseName) !== baseName
  ) {
    throw new Error(`Unsafe output base name: ${String(baseName)}`)
  }
  return baseName
}

// Guards a renderer-supplied extension so it can only ever be one of the three
// image types the app writes — never an arbitrary suffix joined into a path.
export function assertImageExt(ext: unknown): ImageExt {
  if (ext === 'png' || ext === 'jpg' || ext === 'webp') return ext
  throw new Error(`Unsupported image extension: ${String(ext)}`)
}

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
// after the backend so the front timestamp token stays intact. parseOutputOrdinal
// (output-timestamps.ts) inverts this suffix on resume — keep the two in sync.
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
  const dir = getSessionDir()
  fs.mkdirSync(dir, { recursive: true })

  // The allocator already hands out a unique ordinal, so a collision here means
  // a file the allocator didn't know about exists on disk. Rather than throw —
  // which would discard an image that was already generated (and, for cloud
  // backends, billed) — advance to the next free ordinal so the image is always
  // saved. The bump is logged because it should not normally happen.
  let attempt = ordinal
  let baseName = outputBaseName(timestamp, attempt, slug, backend)
  while (
    fs.existsSync(path.join(dir, `${baseName}.${ext}`)) ||
    fs.existsSync(path.join(dir, `${baseName}.json`))
  ) {
    attempt++
    baseName = outputBaseName(timestamp, attempt, slug, backend)
  }
  if (attempt !== ordinal) {
    log('warn', 'Output name collided with existing files; saved under the next free ordinal', {
      timestamp,
      backend,
      requestedOrdinal: ordinal,
      usedOrdinal: attempt,
    })
  }

  fs.writeFileSync(path.join(dir, `${baseName}.${ext}`), imageBuffer)
  fs.writeFileSync(path.join(dir, `${baseName}.json`), JSON.stringify(metadata, null, 2), 'utf-8')

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
