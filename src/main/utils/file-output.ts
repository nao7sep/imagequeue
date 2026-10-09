import type { Translator } from '../../shared/i18n/translate'
import fs from 'fs'
import path from 'path'
import { shell } from 'electron'
import { getSessionDir } from '../session'
import { BackendId, OutputFileState } from '../../shared/types'
import { ImageMetadata } from './image-metadata'
import { log, serializeError } from '../logger'
import { FORMAT_VERSIONS, markFormat, SNAKE_FORMAT_VERSION_KEY } from '../store-format'
import { claimFinalName, stageBeside, stagingPathFor } from './atomic-write'
import { syncDirectory, syncFile } from './fsync'

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

const IMAGE_FORMATS: Record<ImageExt, { format: string; extensions: string[] }> = {
  png: { format: 'PNG', extensions: ['png'] },
  jpg: { format: 'JPEG', extensions: ['jpg', 'jpeg'] },
  webp: { format: 'WebP', extensions: ['webp'] },
}

// The save-dialog filter for an image of this format, and nothing else: an
// export is a byte copy, so any other extension would label the file wrongly.
// The filter's name is the dialog's words, in the interface language.
export function imageFormatFilter(ext: ImageExt, translator: Translator): { name: string; extensions: string[] } {
  const { format, extensions } = IMAGE_FORMATS[ext]
  return { name: translator.t('fileFilter.image', { format }), extensions }
}

// The path an export of this format is written to. Some platforms' save dialogs
// keep an extension the user types even when the filter excludes it, so a path
// not ending in this format's extension gets it appended, never replaced: the
// user's name stays whole and the file is labelled by what it contains.
export function exportPathForFormat(filePath: string, ext: ImageExt): string {
  const typed = path.extname(filePath).slice(1).toLowerCase()
  return IMAGE_FORMATS[ext].extensions.includes(typed) ? filePath : `${filePath}.${ext}`
}

// Copies an exported image byte for byte to a complete, synced staging file
// beside its destination, for the export to publish under its final name. A
// copy keeps its source's modified time and permission mode (content-lifecycle
// conventions); a volume that cannot hold the mode keeps the rest without a
// warning. Node has no portable call that carries birth time, extended
// attributes or Finder tags, so those are not copied.
export function stageExportCopy(src: string, destination: string): string {
  const staging = stagingPathFor(destination)
  try {
    fs.copyFileSync(src, staging)
    const source = fs.statSync(src)
    try {
      fs.chmodSync(staging, source.mode & 0o7777)
    } catch {
      // The destination volume has no POSIX modes; the copy keeps what it can.
    }
    fs.utimesSync(staging, source.atime, source.mtime)
    syncFile(staging)
  } catch (error) {
    fs.rmSync(staging, { force: true })
    throw error
  }
  return staging
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

// Publishes staged bytes under `destination` without replacing a file already
// there; false when the name is taken. The staging file is always removed.
function publishStaged(staging: string, destination: string): boolean {
  try {
    return claimFinalName(staging, destination)
  } finally {
    try { fs.rmSync(staging, { force: true }) } catch (error) {
      log('warn', 'Could not remove generated-output staging', { tempPath: staging, error: serializeError(error) })
    }
  }
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
  // Case-insensitive sibling check (storage-path conventions: a hard
  // invariant): fs.existsSync is case-sensitive on a case-sensitive volume,
  // and the nanoid fallback slug is mixed-case, so an exists() probe alone
  // could admit a name differing only by case.
  const lowerSiblings = new Set(
    (fs.existsSync(dir) ? fs.readdirSync(dir) : []).map((name) => name.toLowerCase())
  )
  const collides = (base: string): boolean =>
    lowerSiblings.has(`${base}.${ext}`.toLowerCase()) || lowerSiblings.has(`${base}.json`.toLowerCase())
  while (collides(baseName)) {
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

  // not recorded: a generated image and its metadata sidecar belong to a session under
  // sessions/<session>/, transient work the user exports what they keep from (data-backup-conventions;
  // the developer's classification). Written directly, not through the managed-text hook.
  //
  // The image is staged complete and claimed under a name nothing holds, so a
  // failed write leaves no truncated file and nothing is ever replaced. A
  // generated (and possibly paid) image is never given up for its sidecar
  // (developer decision): the sidecar follows best effort, and nothing in the
  // app reads it back.
  for (;;) {
    const staged = stageBeside(path.join(dir, `${baseName}.${ext}`), imageBuffer)
    if (publishStaged(staged, path.join(dir, `${baseName}.${ext}`))) break
    // Only an occupied final name advances the ordinal; I/O failures escape.
    attempt++
    baseName = outputBaseName(timestamp, attempt, slug, backend)
    while (collides(baseName)) baseName = outputBaseName(timestamp, ++attempt, slug, backend)
  }

  const sidecarPath = path.join(dir, `${baseName}.json`)
  const sidecar = markFormat(metadata, FORMAT_VERSIONS.imageSidecar, SNAKE_FORMAT_VERSION_KEY)
  try {
    const staged = stageBeside(sidecarPath, Buffer.from(JSON.stringify(sidecar, null, 2), 'utf-8'))
    if (!publishStaged(staged, sidecarPath)) {
      log('warn', 'Generated image was saved but its metadata sidecar name was taken; the sidecar was not written', { baseName })
    }
  } catch (error) {
    log('warn', 'Generated image was saved but its metadata sidecar could not be written', { baseName, error: serializeError(error) })
  }

  try {
    syncDirectory(dir)
  } catch (error) {
    // The image is already published. A secondary durability warning must not
    // mark the paid output failed and invite another generation.
    log('warn', 'Generated image was saved but directory sync failed', { baseName, error: serializeError(error) })
  }

  return baseName
}

/** Inspect settled cleanup without treating an inaccessible path as removed. */
export function imageOutputFileStates(baseName: string, ext: ImageExt): { image: OutputFileState; metadata: OutputFileState } {
  try { assertSafeBaseName(baseName) } catch {
    return { image: 'unknown', metadata: 'unknown' }
  }
  assertImageExt(ext)
  const dir = getSessionDir()
  const state = (file: string): OutputFileState => {
    try { fs.lstatSync(file); return 'remaining' } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'removed' : 'unknown'
    }
  }
  return { image: state(path.join(dir, `${baseName}.${ext}`)), metadata: state(path.join(dir, `${baseName}.json`)) }
}

// Deletes both the image and metadata files for a given base filename.
export function deleteImageOutput(baseName: string, ext: ImageExt): void {
  const dir = getSessionDir()
  assertSafeBaseName(baseName)
  assertImageExt(ext)
  const imagePath = path.join(dir, `${baseName}.${ext}`)
  const metaPath = path.join(dir, `${baseName}.json`)

  if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath)
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath)
}

// Moves the image and metadata files for a given base filename to the OS trash.
export async function trashImageOutput(baseName: string, ext: ImageExt): Promise<void> {
  const dir = getSessionDir()
  assertSafeBaseName(baseName)
  assertImageExt(ext)
  const imagePath = path.join(dir, `${baseName}.${ext}`)
  const metaPath = path.join(dir, `${baseName}.json`)

  if (fs.existsSync(imagePath)) await shell.trashItem(imagePath)
  if (fs.existsSync(metaPath)) await shell.trashItem(metaPath)
}
