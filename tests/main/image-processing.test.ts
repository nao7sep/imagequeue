import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clipboardPng, validateImage } from '../../src/main/image-processing'
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
