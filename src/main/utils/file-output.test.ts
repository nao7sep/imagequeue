import { describe, expect, it } from 'vitest'
import { imageExtFromPath } from './file-output'

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
