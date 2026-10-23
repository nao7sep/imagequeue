import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp, { type Sharp } from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clipboardPng, thumbnailFile, validateImage, deleteImageWithThumbnails, deleteSessionWithThumbnails, clearObsoleteThumbnailCache } from '../../src/main/image-processing'
import * as atomicWrite from '../../src/main/utils/atomic-write'
import { tinyPng } from './image-fixture'

const fixture = vi.hoisted(() => ({ root: '' }))
vi.mock('node:os', async (original) => ({ default: { ...await original<typeof import('node:os')>(), availableParallelism: () => 1 } }))
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
    expect(path.dirname(first)).toBe(path.join(fixture.root, '.thumbnails', 'source.png'))
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

function heldPublication() {
  const write = atomicWrite.writeFileAtomicAsync
  let release!: () => void
  let entered!: () => void
  const hold = new Promise<void>((resolve) => { release = resolve })
  const reached = new Promise<void>((resolve) => { entered = resolve })
  const spy = vi.spyOn(atomicWrite, 'writeFileAtomicAsync').mockImplementation(async (...args) => {
    entered()
    await hold
    await write(...args)
  })
  return { release, reached, spy }
}

it('removes every variant and joins publication before deleting its source', async () => {
  const source = path.join(fixture.root, 'delete.png')
  const other = path.join(fixture.root, 'keep.png')
  await fs.writeFile(source, await tinyPng())
  await fs.writeFile(other, await tinyPng())
  const first = await thumbnailFile(source, 120)
  const retained = await thumbnailFile(other, 120)
  const publication = heldPublication()
  const pending = thumbnailFile(source, 240)
  await publication.reached
  const remove = vi.fn(() => fs.rm(source))
  const deletion = deleteImageWithThumbnails(source, remove)
  expect(remove).not.toHaveBeenCalled()
  await expect(thumbnailFile(source, 360)).rejects.toThrow('being deleted')
  publication.release()
  await pending
  await deletion
  await expect(fs.stat(path.dirname(first))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(fs.stat(source)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(fs.stat(retained)).resolves.toBeDefined()
  await expect(thumbnailFile(source, 240)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(fs.stat(path.dirname(first))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('joins all variants before removing a session and cannot recreate its directory', async () => {
  const directory = path.join(fixture.root, 'session')
  await fs.mkdir(directory)
  const source = path.join(directory, 'image.png')
  await fs.writeFile(source, await tinyPng())
  const publication = heldPublication()
  const first = thumbnailFile(source, 120)
  const second = thumbnailFile(source, 240)
  await publication.reached
  const remove = vi.fn(() => fs.rm(directory, { recursive: true }))
  const deletion = deleteSessionWithThumbnails(directory, remove)
  await expect(thumbnailFile(source, 360)).rejects.toThrow('being deleted')
  expect(remove).not.toHaveBeenCalled()
  publication.release()
  await Promise.all([first, second, deletion])
  await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('keeps the source and permits retry when thumbnail cleanup fails', async () => {
  const source = path.join(fixture.root, 'image.png')
  await fs.writeFile(source, await tinyPng())
  await thumbnailFile(source, 120)
  const rm = vi.spyOn(fs, 'rm').mockRejectedValueOnce(Object.assign(new Error('locked cache'), { code: 'EACCES' }))
  const remove = vi.fn(() => fs.unlink(source))
  await expect(deleteImageWithThumbnails(source, remove)).rejects.toMatchObject({ code: 'EACCES' })
  expect(remove).not.toHaveBeenCalled()
  await expect(fs.stat(source)).resolves.toBeDefined()
  rm.mockRestore()
  await expect(deleteImageWithThumbnails(source, remove)).resolves.toBeUndefined()
})

it('removes only the obsolete flat thumbnail cache', async () => {
  const obsolete = path.join(fixture.root, 'cache', 'thumbnails')
  await fs.mkdir(obsolete, { recursive: true })
  await fs.writeFile(path.join(obsolete, 'old.webp'), 'derived visual copy')
  const source = path.join(fixture.root, 'image.png')
  await fs.writeFile(source, await tinyPng())
  const current = await thumbnailFile(source, 120)
  await fs.writeFile(path.join(fixture.root, 'cache', 'unrelated'), 'keep')
  await clearObsoleteThumbnailCache()
  await expect(fs.stat(obsolete)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(fs.stat(source)).resolves.toBeDefined()
  await expect(fs.stat(current)).resolves.toBeDefined()
  expect(await fs.readFile(path.join(fixture.root, 'cache', 'unrelated'), 'utf8')).toBe('keep')
})

it('releases native capacity during cache publication and bounds retained thumbnail buffers', async () => {
  const source = path.join(fixture.root, 'image.png')
  const bytes = await tinyPng()
  await fs.writeFile(source, bytes)
  const publication = heldPublication()
  const first = thumbnailFile(source, 120)
  await publication.reached
  const second = thumbnailFile(source, 240)
  try {
    await expect(validateImage(bytes)).resolves.toBe('png')
    await expect(clipboardPng(source)).resolves.toBeInstanceOf(Buffer)
    expect(publication.spy).toHaveBeenCalledOnce()
  } finally { publication.release() }
  await Promise.all([first, second])
  expect(publication.spy).toHaveBeenCalledTimes(2)
})

it('admits foreground conversion ahead of a queued thumbnail', async () => {
  const source = path.join(fixture.root, 'image.png')
  const bytes = await tinyPng()
  await fs.writeFile(source, bytes)
  let release!: () => void
  let entered!: () => void
  const hold = new Promise<void>((resolve) => { release = resolve })
  const reached = new Promise<void>((resolve) => { entered = resolve })
  const stats = sharp.prototype.stats
  vi.spyOn(sharp.prototype, 'stats').mockImplementationOnce(async function (this: Sharp) {
    entered()
    await hold
    return stats.call(this)
  })
  const busy = validateImage(bytes)
  await reached
  const access = vi.spyOn(fs, 'access').mockRejectedValue(Object.assign(new Error('uncached'), { code: 'ENOENT' }))
  const thumbnail = thumbnailFile(source, 120)
  await vi.waitFor(() => expect(access).toHaveBeenCalled())
  await new Promise<void>((resolve) => setImmediate(resolve))
  const order: string[] = []
  const png = sharp.prototype.png
  const webp = sharp.prototype.webp
  vi.spyOn(sharp.prototype, 'png').mockImplementation(function (this: Sharp, ...args) { order.push('foreground'); return png.apply(this, args) })
  vi.spyOn(sharp.prototype, 'webp').mockImplementation(function (this: Sharp, ...args) { order.push('thumbnail'); return webp.apply(this, args) })
  const clipboard = clipboardPng(source)
  release()
  await Promise.all([busy, thumbnail, clipboard])
  expect(order).toEqual(['foreground', 'thumbnail'])
})
