import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  assertImageExt,
  assertSafeBaseName,
  imageExtFromPath,
  outputBaseName,
  writeImageOutput
} from '../../../src/main/utils/file-output'
import type { ImageMetadata } from '../../../src/main/utils/image-metadata'

// writeImageOutput writes into getSessionDir(); point it at a fresh temp dir per
// test. The closure reads `sessionDir` only when getSessionDir() is called, by
// which time beforeEach has set it.
let sessionDir = ''
vi.mock('../../../src/main/session', () => ({ getSessionDir: () => sessionDir }))

beforeEach(() => {
  sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-fileout-'))
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
