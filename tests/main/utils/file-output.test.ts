import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  assertImageExt,
  assertSafeBaseName,
  imageExtFromPath,
  outputBaseName,
  writeImageOutput,
  deleteImageOutput,
  trashImageOutput,
  imageOutputFileStates
} from '../../../src/main/utils/file-output'
import type { ImageMetadata } from '../../../src/main/utils/image-metadata'
import { FORMAT_VERSIONS } from '../../../src/main/store-format'
import * as fsync from '../../../src/main/utils/fsync'

// writeImageOutput writes into getSessionDir(); point it at a fresh temp dir per
// test. The closure reads `sessionDir` only when getSessionDir() is called, by
// which time beforeEach has set it.
const trashItem = vi.hoisted(() => vi.fn(async (file: string) => { fs.unlinkSync(file) }))
vi.mock('electron', () => ({ shell: { trashItem } }))

let sessionDir = ''
vi.mock('../../../src/main/session', () => ({ getSessionDir: () => sessionDir }))

beforeEach(() => {
  trashItem.mockClear()
  sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-fileout-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(sessionDir, { recursive: true, force: true })
})

describe('imageExtFromPath', () => {
  it('parses known extensions case-insensitively', async () => {
    expect(imageExtFromPath('foo.png')).toBe('png')
    expect(imageExtFromPath('foo.JPG')).toBe('jpg')
    expect(imageExtFromPath('/a/b/c.webp')).toBe('webp')
  })

  it('uses the last dot in multi-dot paths', async () => {
    expect(imageExtFromPath('20260101-000000-utc-slug-openai.png')).toBe('png')
    expect(imageExtFromPath('a.tar.webp')).toBe('webp')
  })

  it('returns null for unknown or missing extensions', async () => {
    expect(imageExtFromPath('foo.gif')).toBeNull()
    expect(imageExtFromPath('noextension')).toBeNull()
    expect(imageExtFromPath('')).toBeNull()
    expect(imageExtFromPath(null)).toBeNull()
    expect(imageExtFromPath(undefined)).toBeNull()
  })
})

describe('outputBaseName', () => {
  it('omits the suffix for the first output of a second (ordinal 0)', async () => {
    expect(outputBaseName('20260604-093015', 0, 'fluffy-cat', 'drawthings'))
      .toBe('20260604-093015-utc-fluffy-cat-drawthings')
  })

  it('appends a 1-based ordinal tail for same-second collisions', async () => {
    expect(outputBaseName('20260604-093015', 1, 'fluffy-cat', 'drawthings'))
      .toBe('20260604-093015-utc-fluffy-cat-drawthings-2')
    expect(outputBaseName('20260604-093015', 2, 'fluffy-cat', 'drawthings'))
      .toBe('20260604-093015-utc-fluffy-cat-drawthings-3')
  })

  it('keeps the timestamp token parseable even with a numeric slug', async () => {
    // The ordinal sits after the backend, so a numeric slug can't be mistaken
    // for it and the leading `{date}-{time}-utc` token stays intact.
    const name = outputBaseName('20260604-093015', 1, '2', 'openai')
    expect(name).toBe('20260604-093015-utc-2-openai-2')
    expect(/^\d{8}-\d{6}-utc(?:-|$)/.test(name)).toBe(true)
  })
})

describe('writeImageOutput', () => {
  const meta = {} as unknown as ImageMetadata
  const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47])

  it('writes the image and JSON sidecar and returns the base name', async () => {
    const base = (await writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png'))
    expect(base).toBe('20260604-093015-utc-cat-openai')
    expect(fs.existsSync(path.join(sessionDir, `${base}.png`))).toBe(true)
    expect(fs.existsSync(path.join(sessionDir, `${base}.json`))).toBe(true)
  })

  // The app never reads a sidecar back; it is written for others to read.
  it('writes the sidecar with its snake_case format version first', async () => {
    const base = (await writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, { prompt: 'a cat' } as ImageMetadata, 'png'))
    const sidecar = JSON.parse(fs.readFileSync(path.join(sessionDir, `${base}.json`), 'utf8'))
    expect(Object.entries(sidecar)).toEqual([['format_version', FORMAT_VERSIONS.imageSidecar], ['prompt', 'a cat']])
  })

  it('never overwrites: a collision advances to the next free ordinal instead of discarding the image', async () => {
    const first = (await writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png'))
    // A second write that was handed the same ordinal (a file the allocator
    // didn't know about) must neither clobber the first nor be thrown away.
    const second = (await writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png'))
    expect(first).toBe('20260604-093015-utc-cat-openai')
    expect(second).toBe('20260604-093015-utc-cat-openai-2')
    expect(fs.existsSync(path.join(sessionDir, `${first}.png`))).toBe(true)
    expect(fs.existsSync(path.join(sessionDir, `${second}.png`))).toBe(true)
  })

  // The image is staged complete before it gets its name, so a full disk
  // leaves nothing under a final name.
  it('publishes nothing when the image cannot be staged complete', async () => {
    vi.spyOn(fs.promises, 'writeFile').mockImplementationOnce(() => { throw Object.assign(new Error('simulated full disk'), { code: 'ENOSPC' }) })
    await expect(writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png')).rejects.toThrow('simulated full disk')
    expect(fs.readdirSync(sessionDir)).toEqual([])
  })

  it('preserves a staging write failure when removal of that stage also fails', async () => {
    const failure = new Error('primary stage write failure')
    vi.spyOn(fs.promises, 'writeFile').mockImplementation(() => { throw failure })
    vi.spyOn(fs.promises, 'rm').mockImplementation(async () => { throw new Error('secondary cleanup failure') })
    await expect(writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png')).rejects.toThrow(failure)
  })

  it('leaves no staging file beside a published pair', async () => {
    await writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png')
    expect(fs.readdirSync(sessionDir).sort()).toEqual([
      '20260604-093015-utc-cat-openai.json',
      '20260604-093015-utc-cat-openai.png',
    ])
  })

  // A generated, possibly paid, image is never given up for its sidecar.
  it('keeps the image under its final name when the sidecar cannot be published, and logs it', async () => {
    const link = fs.promises.link
    vi.spyOn(fs.promises, 'link').mockImplementation((source, target) => {
      if (String(target).endsWith('.json')) throw new Error('sidecar I/O failure')
      return link(source, target)
    })
    const base = (await writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png'))
    expect(base).toBe('20260604-093015-utc-cat-openai')
    expect(fs.readdirSync(sessionDir)).toEqual([`${base}.png`])
    expect(fs.readFileSync(path.join(sessionDir, `${base}.png`))).toEqual(buf)
  })

  it('keeps the image when the sidecar cannot be staged', async () => {
    const write = fs.promises.writeFile
    let calls = 0
    vi.spyOn(fs.promises, 'writeFile').mockImplementation(((...args: Parameters<typeof fs.promises.writeFile>) => {
      if (++calls === 2) throw Object.assign(new Error('simulated full disk'), { code: 'ENOSPC' })
      return write(...args)
    }) as typeof fs.promises.writeFile)
    const base = (await writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png'))
    expect(fs.readdirSync(sessionDir)).toEqual([`${base}.png`])
  })

  it('never replaces a sidecar that takes its name first, and keeps the image', async () => {
    const link = fs.promises.link
    vi.spyOn(fs.promises, 'link').mockImplementation((source, target) => {
      if (String(target).endsWith('.json')) fs.writeFileSync(target, 'foreign sidecar')
      return link(source, target)
    })
    const base = (await writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png'))
    expect(fs.readFileSync(path.join(sessionDir, `${base}.json`), 'utf8')).toBe('foreign sidecar')
    expect(fs.readFileSync(path.join(sessionDir, `${base}.png`))).toEqual(buf)
  })

  it('takes the next free ordinal when an image takes its name first, never replacing it', async () => {
    const link = fs.promises.link
    let conflict = true
    vi.spyOn(fs.promises, 'link').mockImplementation((source, target) => {
      if (String(target).endsWith('.png') && conflict) {
        conflict = false
        fs.writeFileSync(target, 'foreign image')
      }
      return link(source, target)
    })
    const base = (await writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png'))
    expect(base).toBe('20260604-093015-utc-cat-openai-2')
    expect(fs.readFileSync(path.join(sessionDir, '20260604-093015-utc-cat-openai.png'), 'utf8')).toBe('foreign image')
    expect(fs.readdirSync(sessionDir).sort()).toEqual([`${base}.json`, `${base}.png`, '20260604-093015-utc-cat-openai.png'].sort())
  })

  it('publishes through exclusive copies on a volume without hard links', async () => {
    vi.spyOn(fs.promises, 'link').mockImplementation(() => { throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }) })
    const base = (await writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png'))
    expect(fs.readFileSync(path.join(sessionDir, `${base}.png`))).toEqual(buf)
    expect(fs.readdirSync(sessionDir)).toHaveLength(2)
  })

  it('returns the complete paid output after secondary directory sync failure', async () => {
    vi.spyOn(fsync, 'syncDirectoryAsync').mockImplementationOnce(() => { throw new Error('directory sync failed') })
    const base = (await writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png'))
    expect(fs.readFileSync(path.join(sessionDir, `${base}.png`))).toEqual(buf)
    expect(JSON.parse(fs.readFileSync(path.join(sessionDir, `${base}.json`), 'utf8')).format_version).toBe(FORMAT_VERSIONS.imageSidecar)
    expect(fs.readdirSync(sessionDir)).toHaveLength(2)
  })
})

describe('assertSafeBaseName', () => {
  it('accepts a normal output base name', async () => {
    expect(assertSafeBaseName('20260604-093015-utc-cat-openai')).toBe('20260604-093015-utc-cat-openai')
  })

  it('rejects traversal, separators, and empty/non-string input', async () => {
    expect(() => assertSafeBaseName('../../config')).toThrow()
    expect(() => assertSafeBaseName('a/b')).toThrow()
    expect(() => assertSafeBaseName('a\\b')).toThrow()
    expect(() => assertSafeBaseName('..')).toThrow()
    expect(() => assertSafeBaseName('')).toThrow()
    expect(() => assertSafeBaseName(null)).toThrow()
    expect(() => assertSafeBaseName(42)).toThrow()
  })
})

describe('assertImageExt', () => {
  it('accepts the three image extensions and rejects anything else', async () => {
    expect(assertImageExt('png')).toBe('png')
    expect(assertImageExt('jpg')).toBe('jpg')
    expect(assertImageExt('webp')).toBe('webp')
    expect(() => assertImageExt('json')).toThrow()
    expect(() => assertImageExt('exe')).toThrow()
    expect(() => assertImageExt('')).toThrow()
  })
})


describe('deleting an output', () => {
  it('keeps inaccessible and unsafe cleanup outcomes unknown rather than claiming removal', async () => {
    vi.spyOn(fs.promises, 'lstat').mockImplementation(() => { throw Object.assign(new Error('access denied'), { code: 'EACCES' }) })
    expect((await imageOutputFileStates('image', 'png'))).toEqual({ image: 'unknown', metadata: 'unknown' })
    vi.mocked(fs.promises.lstat).mockClear()
    expect((await imageOutputFileStates('../outside', 'png'))).toEqual({ image: 'unknown', metadata: 'unknown' })
    expect(fs.promises.lstat).not.toHaveBeenCalled()
  })
  // Nothing in the app reads a sidecar, so deleting an output removes whatever
  // sidecar sits beside it.
  it.each([false, true])('deletes an output whose sidecar is from a newer version, unreadable or unmarked (Trash: %s)', async (toTrash) => {
    for (const [name, bytes] of [['newer', JSON.stringify({ format_version: FORMAT_VERSIONS.imageSidecar + 1 })], ['unreadable', '{ invalid'], ['unmarked', '{}']]) {
      fs.writeFileSync(path.join(sessionDir, `${name}.png`), 'image')
      fs.writeFileSync(path.join(sessionDir, `${name}.json`), bytes)
      if (toTrash) await trashImageOutput(name, 'png')
      else (await deleteImageOutput(name, 'png'))
    }
    expect(fs.readdirSync(sessionDir)).toEqual([])
  })

  it.each([false, true])('cleans up an orphan image without a sidecar (Trash: %s)', async (toTrash) => {
    fs.writeFileSync(path.join(sessionDir, 'image.png'), 'image')
    if (toTrash) await trashImageOutput('image', 'png')
    else (await deleteImageOutput('image', 'png'))
    expect(fs.existsSync(path.join(sessionDir, 'image.png'))).toBe(false)
  })
})
