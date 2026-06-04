import { beforeEach, describe, expect, it, vi } from 'vitest'
import { detectImageExt } from '../../../src/main/utils/detect-image-type'
import { log } from '../../../src/main/logger'

vi.mock('../../../src/main/logger', () => ({ log: vi.fn() }))

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])

describe('detectImageExt', () => {
  beforeEach(() => vi.mocked(log).mockClear())

  it('identifies PNG/JPEG/WEBP by magic bytes', () => {
    expect(detectImageExt(PNG, null, 'jpg')).toBe('png')
    expect(detectImageExt(JPG, null, 'png')).toBe('jpg')
    expect(detectImageExt(WEBP, null, 'png')).toBe('webp')
  })

  it('uses the MIME hint when bytes are unrecognized', () => {
    const blank = Buffer.from([0, 1, 2, 3])
    expect(detectImageExt(blank, 'image/png', 'jpg')).toBe('png')
    expect(detectImageExt(blank, 'image/jpeg', 'png')).toBe('jpg')
    expect(detectImageExt(blank, 'image/webp', 'png')).toBe('webp')
  })

  it('normalizes MIME case, the jpg alias, and parameters', () => {
    const blank = Buffer.from([0, 1, 2, 3])
    expect(detectImageExt(blank, 'IMAGE/PNG', 'jpg')).toBe('png')
    expect(detectImageExt(blank, 'image/jpg', 'png')).toBe('jpg')
    expect(detectImageExt(blank, 'image/png; charset=binary', 'jpg')).toBe('png')
  })

  it('prefers magic bytes over a disagreeing MIME hint, and warns', () => {
    expect(detectImageExt(PNG, 'image/jpeg', 'webp')).toBe('png')
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('disagree'), expect.anything())
  })

  it('falls back when neither MIME nor bytes are known, and warns', () => {
    const blank = Buffer.from([0, 1, 2, 3])
    expect(detectImageExt(blank, 'application/octet-stream', 'webp')).toBe('webp')
    expect(detectImageExt(blank, null, 'jpg')).toBe('jpg')
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('fallback'), expect.anything())
  })

  it('does not false-positive on buffers shorter than a signature', () => {
    expect(detectImageExt(Buffer.from([0x89, 0x50]), null, 'jpg')).toBe('jpg')
    expect(detectImageExt(Buffer.from([0x52, 0x49, 0x46, 0x46]), null, 'png')).toBe('png')
  })
})
