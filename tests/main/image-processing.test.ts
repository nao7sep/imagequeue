import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clipboardPng, thumbnailFile, validateImage } from '../../src/main/image-processing'
import * as atomicWrite from '../../src/main/utils/atomic-write'
import { tinyPng } from './image-fixture'

const fixture = vi.hoisted(() => ({ root: '' }))
vi.mock('../../src/main/config', () => ({ getDataDir: () => fixture.root }))

beforeEach(async () => { fixture.root = await fs.mkdtemp(path.join(os.tmpdir(), 'imagequeue-processing-')) })
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(fixture.root, { recursive: true, force: true })
})

describe('image admission', () => {
  it.each(['png', 'jpeg', 'webp'] as const)('fully decodes %s and derives its actual type', async format => {
    const bytes = await sharp(await tinyPng()).toFormat(format).toBuffer()
    await expect(validateImage(bytes)).resolves.toBe(format === 'jpeg' ? 'jpg' : format)
  })

  it('rejects HTML and unsupported image formats', async () => {
    await expect(validateImage(Buffer.from('<html>not an image</html>'))).rejects.toThrow()
    await expect(validateImage(await sharp(await tinyPng()).gif().toBuffer())).rejects.toThrow('supported image')
  })

  it('rejects a truncated image whose metadata is still readable', async () => {
    const complete = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#aabbcc' } }).jpeg().toBuffer()
    const truncated = complete.subarray(0, complete.length - 100)
    expect((await sharp(truncated).metadata()).format).toBe('jpeg')
    await expect(validateImage(truncated)).rejects.toThrow()
  })
})

describe('clipboard image normalization', () => {
  it('asynchronously returns a full-size PNG decoded from a different source format', async () => {
    const source = path.join(fixture.root, 'image.webp')
    const bytes = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#336699' } }).webp().toBuffer()
    await fs.writeFile(source, bytes)
    const pending = clipboardPng(source)
    expect(pending).toBeInstanceOf(Promise)
    const png = await pending
    expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width: 640, height: 360 })
    await expect(validateImage(png)).resolves.toBe('png')
    expect(await fs.readFile(source)).toEqual(bytes)
  })
})

describe('thumbnail cache', () => {
  async function sourceImage(): Promise<{ source: string; bytes: Buffer }> {
    const source = path.join(fixture.root, 'source.png')
    const bytes = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#123456' } }).png().toBuffer()
    await fs.writeFile(source, bytes)
    return { source, bytes }
  }

  it('stores a small variant by source identity, modification time and requested size', async () => {
    const { source, bytes } = await sourceImage()
    const first = await thumbnailFile(source, 240)
    expect(path.dirname(first)).toBe(path.join(fixture.root, 'cache', 'thumbnails'))
    expect(await sharp(first).metadata()).toMatchObject({ format: 'webp', width: 240, height: 160 })
    expect(await thumbnailFile(source, 240)).toBe(first)
    expect(await thumbnailFile(source, 120)).not.toBe(first)
    const info = await fs.stat(source)
    await fs.utimes(source, info.atime, new Date(info.mtimeMs + 2000))
    const modified = await thumbnailFile(source, 240)
    expect(modified).not.toBe(first)
    const replacement = path.join(fixture.root, 'replacement.png')
    await fs.writeFile(replacement, bytes)
    const modifiedInfo = await fs.stat(source)
    await fs.utimes(replacement, modifiedInfo.atime, modifiedInfo.mtime)
    await fs.rename(replacement, source)
    expect(await thumbnailFile(source, 240)).not.toBe(modified)
    expect(await fs.readFile(source)).toEqual(bytes)
  })

  it('coalesces concurrent requests for the same variant into one publication', async () => {
    const { source } = await sourceImage()
    const write = atomicWrite.writeFileAtomicAsync
    let release!: () => void
    let entered!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const writing = new Promise<void>(resolve => { entered = resolve })
    const publication = vi.spyOn(atomicWrite, 'writeFileAtomicAsync').mockImplementation(async (...args) => {
      entered()
      await held
      await write(...args)
    })
    const requests = Array.from({ length: 8 }, () => thumbnailFile(source, 240))
    await writing
    expect(publication).toHaveBeenCalledOnce()
    release()
    const results = await Promise.all(requests)
    expect(new Set(results).size).toBe(1)
    expect(publication).toHaveBeenCalledOnce()
    expect(await sharp(results[0]).metadata()).toMatchObject({ width: 240, height: 160 })
  })
})
