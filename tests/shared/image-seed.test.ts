import { describe, expect, it } from 'vitest'
import { resolveImageSeed } from '../../src/shared/image-seed'
import { toDrawThingsTaskParams } from '../../src/shared/draw-things-params'

const params = { width: 512, height: 512, steps: 4, guidance: 1, negativePrompt: '' }
describe('whole image seed admission', () => {
  it.each(['123oops', '1,234', '42.5', '1e6', '0x42', 'NaN', 'Infinity', '--2', '1 2', '9007199254740992'])(
    'rejects %j without converting a numeric prefix', (text) => {
      expect(resolveImageSeed(text, 'flux')).toEqual({ valid: false })
      expect(resolveImageSeed(text, 'drawthings')).toEqual({ valid: false })
      expect(toDrawThingsTaskParams({ ...params, seed: text })).toBeNull()
    },
  )
  it('preserves the distinct random intent and explicit zero', () => {
    expect(resolveImageSeed('  ', 'flux')).toEqual({ valid: true, seed: null })
    expect(resolveImageSeed('', 'drawthings')).toEqual({ valid: true, seed: 0 })
    expect(resolveImageSeed('0', 'flux')).toEqual({ valid: true, seed: 0 })
    expect(resolveImageSeed('0', 'drawthings')).toEqual({ valid: true, seed: 0 })
  })
  it('accepts exactly representable signed FLUX integers and unsigned 32-bit Draw Things seeds', () => {
    for (const value of [Number.MIN_SAFE_INTEGER, -1, Number.MAX_SAFE_INTEGER]) {
      expect(resolveImageSeed(String(value), 'flux')).toEqual({ valid: true, seed: value })
      expect(resolveImageSeed(String(value), 'drawthings')).toEqual({ valid: false })
    }
    expect(resolveImageSeed(' +00042 ', 'flux')).toEqual({ valid: true, seed: 42 })
    expect(resolveImageSeed('4294967295', 'drawthings')).toEqual({ valid: true, seed: 4294967295 })
    expect(resolveImageSeed('4294967296', 'drawthings')).toEqual({ valid: false })
  })
})
