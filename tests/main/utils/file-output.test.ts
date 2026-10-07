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
  trashImageOutput
} from '../../../src/main/utils/file-output'
import type { ImageMetadata } from '../../../src/main/utils/image-metadata'
import { FORMAT_VERSIONS, NewerFormatError, StoreLeftInPlaceError } from '../../../src/main/store-format'
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
  it('parses known extensions case-insensitively', () => {
    expect(imageExtFromPath('foo.png')).toBe('png')
    expect(imageExtFromPath('foo.JPG')).toBe('jpg')
    expect(imageExtFromPath('/a/b/c.webp')).toBe('webp')
  })

  it('uses the last dot in multi-dot paths', () => {
    expect(imageExtFromPath('20260101-000000-utc-slug-openai.png')).toBe('png')
    expect(imageExtFromPath('a.tar.webp')).toBe('webp')
  })

  it('returns null for unknown or missing extensions', () => {
    expect(imageExtFromPath('foo.gif')).toBeNull()
    expect(imageExtFromPath('noextension')).toBeNull()
    expect(imageExtFromPath('')).toBeNull()
    expect(imageExtFromPath(null)).toBeNull()
    expect(imageExtFromPath(undefined)).toBeNull()
  })
})

describe('outputBaseName', () => {
  it('omits the suffix for the first output of a second (ordinal 0)', () => {
    expect(outputBaseName('20260604-093015', 0, 'fluffy-cat', 'drawthings'))
      .toBe('20260604-093015-utc-fluffy-cat-drawthings')
  })

  it('appends a 1-based ordinal tail for same-second collisions', () => {
    expect(outputBaseName('20260604-093015', 1, 'fluffy-cat', 'drawthings'))
      .toBe('20260604-093015-utc-fluffy-cat-drawthings-2')
    expect(outputBaseName('20260604-093015', 2, 'fluffy-cat', 'drawthings'))
      .toBe('20260604-093015-utc-fluffy-cat-drawthings-3')
  })

  it('keeps the timestamp token parseable even with a numeric slug', () => {
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

  it('writes the image and JSON sidecar and returns the base name', () => {
    const base = writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png')
    expect(base).toBe('20260604-093015-utc-cat-openai')
    expect(fs.existsSync(path.join(sessionDir, `${base}.png`))).toBe(true)
    expect(fs.existsSync(path.join(sessionDir, `${base}.json`))).toBe(true)
  })

  // The app never reads a sidecar back; it is written for others to read.
  it('writes the sidecar with its snake_case format version first', () => {
    const base = writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, { prompt: 'a cat' } as ImageMetadata, 'png')
    const sidecar = JSON.parse(fs.readFileSync(path.join(sessionDir, `${base}.json`), 'utf8'))
    expect(Object.entries(sidecar)).toEqual([['format_version', FORMAT_VERSIONS.imageSidecar], ['prompt', 'a cat']])
  })

  it('never overwrites: a collision advances to the next free ordinal instead of discarding the image', () => {
    const first = writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png')
    // A second write that was handed the same ordinal (a file the allocator
    // didn't know about) must neither clobber the first nor be thrown away.
    const second = writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png')
    expect(first).toBe('20260604-093015-utc-cat-openai')
    expect(second).toBe('20260604-093015-utc-cat-openai-2')
    expect(fs.existsSync(path.join(sessionDir, `${first}.png`))).toBe(true)
    expect(fs.existsSync(path.join(sessionDir, `${second}.png`))).toBe(true)
  })

  // A full disk while staging the sidecar must not publish the image alone,
  // nor leave a truncated file under either final name.
  it('publishes neither file when the pair cannot be staged complete', () => {
    const write = fs.writeFileSync
    let calls = 0
    vi.spyOn(fs, 'writeFileSync').mockImplementation(((...args: Parameters<typeof fs.writeFileSync>) => {
      if (++calls === 2) throw Object.assign(new Error('simulated full disk'), { code: 'ENOSPC' })
      return write(...args)
    }) as typeof fs.writeFileSync)
    expect(() => writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png')).toThrow('simulated full disk')
    expect(fs.readdirSync(sessionDir)).toEqual([])
  })

  it('preserves a staging write failure when removal of that stage also fails', () => {
    const failure = new Error('primary stage write failure')
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw failure })
    vi.spyOn(fs, 'rmSync').mockImplementation(() => { throw new Error('secondary cleanup failure') })
    expect(() => writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png')).toThrow(failure)
  })

  it('leaves no staging file beside a published pair', () => {
    writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png')
    expect(fs.readdirSync(sessionDir).sort()).toEqual([
      '20260604-093015-utc-cat-openai.json',
      '20260604-093015-utc-cat-openai.png',
    ])
  })

  it('rolls back its image if exclusive sidecar publication fails, preserving the cause', () => {
    const link = fs.linkSync
    const failure = new Error('sidecar I/O failure')
    vi.spyOn(fs, 'linkSync').mockImplementation((source, target) => {
      if (String(target).endsWith('.json')) throw failure
      link(source, target)
    })
    expect(() => writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png')).toThrow(failure)
    expect(fs.readdirSync(sessionDir)).toEqual([])
  })

  it('preserves a foreign sidecar and saves the pair at the next occupied-name ordinal', () => {
    const link = fs.linkSync
    let conflict = true
    vi.spyOn(fs, 'linkSync').mockImplementation((source, target) => {
      if (String(target).endsWith('.json') && conflict) {
        conflict = false
        fs.writeFileSync(target, 'foreign sidecar')
      }
      link(source, target)
    })
    const base = writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png')
    expect(base).toBe('20260604-093015-utc-cat-openai-2')
    expect(fs.readFileSync(path.join(sessionDir, '20260604-093015-utc-cat-openai.json'), 'utf8')).toBe('foreign sidecar')
    expect(fs.existsSync(path.join(sessionDir, '20260604-093015-utc-cat-openai.png'))).toBe(false)
    expect(fs.readdirSync(sessionDir).sort()).toEqual([`${base}.json`, `${base}.png`, '20260604-093015-utc-cat-openai.json'].sort())
  })

  it('never rolls back a replaced image when sidecar publication fails', () => {
    const link = fs.linkSync
    const failure = new Error('sidecar I/O failure')
    vi.spyOn(fs, 'linkSync').mockImplementation((source, target) => {
      if (String(target).endsWith('.json')) {
        const image = String(target).replace(/\.json$/, '.png')
        fs.unlinkSync(image)
        fs.writeFileSync(image, 'foreign image')
        throw failure
      }
      link(source, target)
    })
    expect(() => writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png')).toThrow(failure)
    expect(fs.readFileSync(path.join(sessionDir, '20260604-093015-utc-cat-openai.png'), 'utf8')).toBe('foreign image')
  })

  it.each(['file', 'symlink'] as const)('never adopts a foreign %s identity returned after image claim', (replacement) => {
    const link = fs.linkSync
    const failure = new Error('sidecar publication failed')
    vi.spyOn(fs, 'linkSync').mockImplementation((source, target) => {
      if (String(target).endsWith('.json')) throw failure
      link(source, target)
      fs.unlinkSync(target)
      if (replacement === 'symlink') fs.symlinkSync(source, target)
      else fs.writeFileSync(target, 'foreign image')
    })
    expect(() => writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png')).toThrow(failure)
    const image = path.join(sessionDir, '20260604-093015-utc-cat-openai.png')
    if (replacement === 'symlink') expect(fs.lstatSync(image).isSymbolicLink()).toBe(true)
    else expect(fs.readFileSync(image, 'utf8')).toBe('foreign image')
  })

  it('publishes through exclusive handles on a volume without hard links', () => {
    vi.spyOn(fs, 'linkSync').mockImplementation(() => { throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }) })
    const base = writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png')
    expect(fs.readFileSync(path.join(sessionDir, `${base}.png`))).toEqual(buf)
    expect(fs.readdirSync(sessionDir)).toHaveLength(2)
  })

  it('rolls back both owned copies when the sidecar copy fails', () => {
    vi.spyOn(fs, 'linkSync').mockImplementation(() => { throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }) })
    const write = fs.writeFileSync
    const failure = new Error('sidecar copy failed')
    let calls = 0
    vi.spyOn(fs, 'writeFileSync').mockImplementation(((...args: Parameters<typeof fs.writeFileSync>) => {
      if (++calls === 4) throw failure
      return write(...args)
    }) as typeof fs.writeFileSync)
    expect(() => writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png')).toThrow(failure)
    expect(fs.readdirSync(sessionDir)).toEqual([])
  })

  it('preserves the original publish cause when owned rollback and staging cleanup also fail', () => {
    const link = fs.linkSync
    const failure = new Error('primary sidecar failure')
    vi.spyOn(fs, 'linkSync').mockImplementation((source, target) => {
      if (String(target).endsWith('.json')) throw failure
      link(source, target)
    })
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw new Error('secondary rollback failure') })
    vi.spyOn(fs, 'rmSync').mockImplementation(() => { throw new Error('secondary staging cleanup failure') })
    expect(() => writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png')).toThrow(failure)
  })

  it('returns the complete paid output after secondary directory sync failure', () => {
    vi.spyOn(fsync, 'syncDirectory').mockImplementationOnce(() => { throw new Error('directory sync failed') })
    const base = writeImageOutput('20260604-093015', 0, 'cat', 'openai', buf, meta, 'png')
    expect(fs.readFileSync(path.join(sessionDir, `${base}.png`))).toEqual(buf)
    expect(JSON.parse(fs.readFileSync(path.join(sessionDir, `${base}.json`), 'utf8')).format_version).toBe(FORMAT_VERSIONS.imageSidecar)
    expect(fs.readdirSync(sessionDir)).toHaveLength(2)
  })
})

describe('assertSafeBaseName', () => {
  it('accepts a normal output base name', () => {
    expect(assertSafeBaseName('20260604-093015-utc-cat-openai')).toBe('20260604-093015-utc-cat-openai')
  })

  it('rejects traversal, separators, and empty/non-string input', () => {
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
  it('accepts the three image extensions and rejects anything else', () => {
    expect(assertImageExt('png')).toBe('png')
    expect(assertImageExt('jpg')).toBe('jpg')
    expect(assertImageExt('webp')).toBe('webp')
    expect(() => assertImageExt('json')).toThrow()
    expect(() => assertImageExt('exe')).toThrow()
    expect(() => assertImageExt('')).toThrow()
  })
})


describe('governing image-sidecar deletion admission', () => {
  it.each(['permanent', 'Trash'] as const)('preserves both outputs with a future sidecar during %s deletion', async (operation) => {
    const image = path.join(sessionDir, 'image.png')
    const sidecar = path.join(sessionDir, 'image.json')
    fs.writeFileSync(image, 'image')
    const bytes = JSON.stringify({ format_version: FORMAT_VERSIONS.imageSidecar + 1 })
    fs.writeFileSync(sidecar, bytes)
    if (operation === 'Trash') await expect(trashImageOutput('image', 'png')).rejects.toMatchObject({ name: 'NewerFormatError', path: sidecar })
    else expect(() => deleteImageOutput('image', 'png')).toThrow(NewerFormatError)
    expect(fs.readFileSync(image, 'utf8')).toBe('image')
    expect(fs.readFileSync(sidecar, 'utf8')).toBe(bytes)
    expect(trashItem).not.toHaveBeenCalled()
  })

  it.each(['{ invalid', '{}', '[]'])('preserves both outputs when sidecar is unreadable: %s', async (bytes) => {
    fs.writeFileSync(path.join(sessionDir, 'image.png'), 'image')
    fs.writeFileSync(path.join(sessionDir, 'image.json'), bytes)
    expect(() => deleteImageOutput('image', 'png')).toThrow(StoreLeftInPlaceError)
    await expect(trashImageOutput('image', 'png')).rejects.toBeInstanceOf(StoreLeftInPlaceError)
    expect(fs.readFileSync(path.join(sessionDir, 'image.png'), 'utf8')).toBe('image')
    expect(fs.readFileSync(path.join(sessionDir, 'image.json'), 'utf8')).toBe(bytes)
    expect(trashItem).not.toHaveBeenCalled()
  })

  it('checks the sidecar again after awaited image Trash before its own handoff', async () => {
    const image = path.join(sessionDir, 'image.png')
    const sidecar = path.join(sessionDir, 'image.json')
    fs.writeFileSync(image, 'image')
    fs.writeFileSync(sidecar, JSON.stringify({ format_version: FORMAT_VERSIONS.imageSidecar }))
    let settle!: () => void
    trashItem.mockImplementationOnce((file) => new Promise<void>((resolve) => {
      settle = () => { fs.unlinkSync(file); resolve() }
    }))
    const deletion = trashImageOutput('image', 'png')
    const newer = JSON.stringify({ format_version: FORMAT_VERSIONS.imageSidecar + 1 })
    try {
      fs.writeFileSync(sidecar, newer)
    } finally {
      settle()
    }
    await expect(deletion).rejects.toMatchObject({ name: 'NewerFormatError', path: sidecar })
    expect(fs.existsSync(image)).toBe(false)
    expect(fs.readFileSync(sidecar, 'utf8')).toBe(newer)
    expect(trashItem).toHaveBeenCalledExactlyOnceWith(image)
  })

  it.each([false, true])('cleans up an orphan image without a sidecar (Trash: %s)', async (toTrash) => {
    fs.writeFileSync(path.join(sessionDir, 'image.png'), 'image')
    if (toTrash) await trashImageOutput('image', 'png')
    else deleteImageOutput('image', 'png')
    expect(fs.existsSync(path.join(sessionDir, 'image.png'))).toBe(false)
  })
})
