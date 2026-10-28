import sharp from 'sharp'
import type { ImageExt } from './utils/file-output'

// libvips decodes and encodes on its own native threads, off the JS thread.
export async function validateImage(bytes: Buffer): Promise<ImageExt> {
  const image = sharp(bytes, { failOn: 'warning' })
  const metadata = await image.metadata()
  const ext = metadata.format === 'jpeg' ? 'jpg' : metadata.format
  if (ext !== 'png' && ext !== 'jpg' && ext !== 'webp') throw new Error('Provider did not deliver a supported image')
  // Metadata alone can describe a truncated image. Statistics forces full
  // decoding without copying full-resolution pixels into JavaScript.
  await image.stats()
  return ext
}

export function clipboardPng(file: string): Promise<Buffer> {
  return sharp(file, { failOn: 'warning' }).rotate().png().toBuffer()
}
