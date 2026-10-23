import sharp from 'sharp'

// A complete image for tests that mean a provider delivered valid bytes.
let png: Promise<Buffer> | undefined
export function tinyPng(): Promise<Buffer> {
  return png ??= sharp({ create: { width: 3, height: 2, channels: 3, background: '#2468ac' } }).png().toBuffer()
}
