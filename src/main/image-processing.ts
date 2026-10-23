import sharp from 'sharp'
import os from 'node:os'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { getDataDir } from './config'
import { writeFileAtomicAsync } from './utils/atomic-write'
import type { ImageExt } from './utils/file-output'

// libvips performs decoding/encoding off the JS thread. Bound simultaneously
// admitted pipelines by the host's CPU budget and each pipeline's native pool.
const capacity = Math.max(1, Math.floor(os.availableParallelism() / Math.max(1, sharp.concurrency())))
let running = 0
const foreground: Array<() => void> = []
const background: Array<() => void> = []
async function processing<T>(operation: () => Promise<T>, thumbnail = false): Promise<T> {
  if (running >= capacity) await new Promise<void>((resolve) => (thumbnail ? background : foreground).push(resolve))
  else running++
  try { return await operation() } finally {
    const next = foreground.shift() ?? background.shift()
    if (next) next()
    else running--
  }
}
export function validateImage(bytes: Buffer): Promise<ImageExt> {
  return processing(async () => {
    const image = sharp(bytes, { failOn: 'warning' })
    const metadata = await image.metadata()
    const ext = metadata.format === 'jpeg' ? 'jpg' : metadata.format
    if (ext !== 'png' && ext !== 'jpg' && ext !== 'webp') throw new Error('Provider did not deliver a supported image')
    // Metadata alone can describe a truncated image. Statistics forces full
    // decoding without copying full-resolution pixels into JavaScript.
    await image.stats()
    return ext
  })
}
export function clipboardPng(file: string): Promise<Buffer> {
  return processing(() => sharp(file, { failOn: 'warning' }).rotate().png().toBuffer())
}
// Thumbnail pipelines have their own host-derived limit, so slow publication
// retains only a bounded number of encoded buffers. Waiting work keeps paths,
// not image bytes, and never reserves the shared native conversion capacity.
let activeThumbnails = 0
const waitingThumbnails: Array<() => void> = []
async function thumbnailPipeline<T>(operation: () => Promise<T>): Promise<T> {
  if (activeThumbnails >= capacity) await new Promise<void>((resolve) => waitingThumbnails.push(resolve))
  else activeThumbnails++
  try { return await operation() } finally {
    const next = waitingThumbnails.shift()
    if (next) next()
    else activeThumbnails--
  }
}

const pendingThumbnails = new Map<string, { file: string; result: Promise<string> }>()
const deletingImages = new Set<string>()
const deletingSessions = new Set<string>()
const thumbnailDirectory = (file: string): string => path.join(path.dirname(file), '.thumbnails', path.basename(file))

export function thumbnailFile(file: string, size: number): Promise<string> {
  if (deletingImages.has(file) || deletingSessions.has(path.dirname(file))) {
    return Promise.reject(new Error('The thumbnail source is being deleted'))
  }
  const key = JSON.stringify([file, size])
  const existing = pendingThumbnails.get(key)
  if (existing) return existing.result
  const operation = thumbnailPipeline(async () => {
    const source = await fs.stat(file)
    const id = createHash('sha256').update(JSON.stringify([source.ino, source.size, source.mtimeMs, size])).digest('hex')
    const destination = path.join(thumbnailDirectory(file), `${id}.webp`)
    try { await fs.access(destination); return destination } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const bytes = await processing(() => sharp(file, { failOn: 'warning' })
      .rotate().resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true }).webp().toBuffer(), true)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await writeFileAtomicAsync(destination, bytes, false)
    return destination
  })
  const result = operation.finally(() => { pendingThumbnails.delete(key) })
  pendingThumbnails.set(key, { file, result })
  return result
}

/** Stop admitting derived copies before waiting for admitted publication. The
 * source stays present if cache cleanup fails, so deletion remains retryable. */
export async function deleteImageWithThumbnails(file: string, removeSource: () => Promise<void>): Promise<void> {
  deletingImages.add(file)
  try {
    await Promise.allSettled([...pendingThumbnails.values()].filter((entry) => entry.file === file).map((entry) => entry.result))
    await fs.rm(thumbnailDirectory(file), { recursive: true, force: true })
    await removeSource()
  } finally { deletingImages.delete(file) }
}

/** Session-local caches go with the session, after their publishers settle. */
export async function deleteSessionWithThumbnails(directory: string, removeSession: () => Promise<void>): Promise<void> {
  deletingSessions.add(directory)
  try {
    await Promise.allSettled([...pendingThumbnails.values()].filter((entry) => path.dirname(entry.file) === directory).map((entry) => entry.result))
    await removeSession()
  } finally { deletingSessions.delete(directory) }
}

/** The old flat derived cache cannot identify deleted sources. It is no longer
 * read or written; removing it once per launch also removes those visual copies. */
export async function clearObsoleteThumbnailCache(): Promise<void> {
  await fs.rm(path.join(getDataDir(), 'cache', 'thumbnails'), { recursive: true, force: true })
}
