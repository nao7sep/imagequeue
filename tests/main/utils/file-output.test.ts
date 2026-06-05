import { describe, expect, it } from 'vitest'
import { imageExtFromPath, outputBaseName } from '../../../src/main/utils/file-output'

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
