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
const waiting: Array<() => void> = []
async function processing<T>(operation: () => Promise<T>): Promise<T> {
  if (running >= capacity) await new Promise<void>((resolve) => waiting.push(resolve))
  else running++
  try { return await operation() } finally {
    const next = waiting.shift()
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
const pendingThumbnails = new Map<string, Promise<string>>()
export async function thumbnailFile(file: string, size: number): Promise<string> {
  const source = await fs.stat(file)
  const id = createHash('sha256').update(JSON.stringify([file, source.ino, source.size, source.mtimeMs, size])).digest('hex')
  const existing = pendingThumbnails.get(id)
  if (existing) return existing
  const operation = processing(async () => {
    const destination = path.join(getDataDir(), 'cache', 'thumbnails', `${id}.webp`)
    try { await fs.access(destination); return destination } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const bytes = await sharp(file, { failOn: 'warning' })
      .rotate().resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true }).webp().toBuffer()
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await writeFileAtomicAsync(destination, bytes, false)
    return destination
  })
  pendingThumbnails.set(id, operation)
  try { return await operation } finally { pendingThumbnails.delete(id) }
}
