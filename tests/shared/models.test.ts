import { describe, expect, it } from 'vitest'
import {
  estimateCostFromRegistry,
  findModel,
  FLUX_MODELS,
  GROK_MODELS,
  IMAGEN_MODELS,
  NANO_BANANA_MODELS,
  OPENAI_MODELS
} from '../../src/shared/models'

describe('estimateCostFromRegistry', () => {
  it('returns null for unknown models and the local-only backend', () => {
    expect(estimateCostFromRegistry('openai', 'no-such-model', { quality: 'high' })).toBeNull()
    expect(estimateCostFromRegistry('drawthings', 'anything', {})).toBeNull()
  })

  it('returns null when OpenAI quality is auto (not modeled)', () => {
    expect(estimateCostFromRegistry('openai', 'gpt-image-1', { quality: 'auto' })).toBeNull()
    // Missing quality defaults to auto.
    expect(estimateCostFromRegistry('openai', 'gpt-image-1', {})).toBeNull()
  })

  it('picks square vs rect table price for fixed-size OpenAI models', () => {
    const m = findModel('openai', 'gpt-image-1')!
    expect(estimateCostFromRegistry('openai', 'gpt-image-1', { quality: 'high', width: 1024, height: 1024 }))
      .toBe(m.pricing.high.square)
    expect(estimateCostFromRegistry('openai', 'gpt-image-1', { quality: 'high', width: 1536, height: 1024 }))
      .toBe(m.pricing.high.rect)
  })

  it('reproduces gpt-image-2 anchor prices via the tile formula', () => {
    const m = findModel('openai', 'gpt-image-2')!
    // 1024x1024 = 4 tiles = square anchor; 1024x1536 = 6 tiles = rect anchor.
    expect(estimateCostFromRegistry('openai', 'gpt-image-2', { quality: 'medium', width: 1024, height: 1024 }))
      .toBeCloseTo(m.pricing.medium.square, 10)
    expect(estimateCostFromRegistry('openai', 'gpt-image-2', { quality: 'medium', width: 1024, height: 1536 }))
      .toBeCloseTo(m.pricing.medium.rect, 10)
  })

  it('scales gpt-image-2 custom sizes by 512px tiles', () => {
    const m = findModel('openai', 'gpt-image-2')!
    // 2048x2048 = 4x4 = 16 tiles; square anchor = 4 tiles -> 4x the square price.
    expect(estimateCostFromRegistry('openai', 'gpt-image-2', { quality: 'high', width: 2048, height: 2048 }))
      .toBeCloseTo((16 / 4) * m.pricing.high.square, 10)
  })

  it('tiers FLUX cost by megapixels', () => {
    const m = findModel('flux', 'flux-2-pro')!
    // 1 MP -> firstMp only.
    expect(estimateCostFromRegistry('flux', 'flux-2-pro', { width: 1024, height: 1024 }))
      .toBeCloseTo(m.pricing.firstMp, 10)
    // 4 MP -> firstMp + 3 * additionalMp.
    expect(estimateCostFromRegistry('flux', 'flux-2-pro', { width: 2048, height: 2048 }))
      .toBeCloseTo(m.pricing.firstMp + 3 * m.pricing.additionalMp, 10)
  })

  it('floors FLUX cost at one megapixel', () => {
    const m = findModel('flux', 'flux-2-pro')!
    expect(estimateCostFromRegistry('flux', 'flux-2-pro', { width: 256, height: 256 }))
      .toBeCloseTo(m.pricing.firstMp, 10)
  })

  it('looks up Nano Banana price by image size, falling back to 1K', () => {
    const m = findModel('nanobanana', 'gemini-3.1-flash-image-preview')!
    expect(estimateCostFromRegistry('nanobanana', m.id, { imageSize: '4K' })).toBe(m.pricing['4K'])
    expect(estimateCostFromRegistry('nanobanana', m.id, {})).toBe(m.pricing['1K'])
    expect(estimateCostFromRegistry('nanobanana', m.id, { imageSize: 'bogus' })).toBe(m.pricing['1K'])
  })

  it('returns the flat price for Imagen and Grok', () => {
    expect(estimateCostFromRegistry('imagen', 'imagen-4.0-generate-001', {})).toBe(0.04)
    expect(estimateCostFromRegistry('grok', 'grok-imagine-image', {})).toBe(0.02)
  })
})

describe('model registry invariants', () => {
  const groups = [
    ['openai', OPENAI_MODELS],
    ['imagen', IMAGEN_MODELS],
    ['nanobanana', NANO_BANANA_MODELS],
    ['grok', GROK_MODELS],
    ['flux', FLUX_MODELS]
  ] as const

  it('has unique model ids within each backend', () => {
    for (const [, models] of groups) {
      const ids = models.map((m) => m.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('has exactly one default model per backend', () => {
    for (const [backend, models] of groups) {
      const defaults = models.filter((m) => m.isDefault)
      expect(defaults.length, `${backend} should have one default`).toBe(1)
    }
  })

  it('prices every supported image size for Nano Banana models', () => {
    for (const m of NANO_BANANA_MODELS) {
      for (const size of m.imageSizes) {
        expect(m.pricing[size.value], `${m.id} missing price for ${size.value}`).toBeTypeOf('number')
      }
    }
  })
})
