import { describe, expect, it } from 'vitest'
import {
  dtFallbacksFromSettings,
  resolveDtParams,
  toDrawThingsTaskParams,
} from '../../../../src/renderer/src/utils/drawThingsParams'

// The one answer to "what parameters does a Draw Things model generate with".
// The column and Advanced Prompting each had a copy of this precedence and its
// gates, already divergent (the column enqueued seed 0; the modal did not).

const FALLBACKS = { width: 512, height: 512, steps: 4, guidance: 1, seed: '', negativePrompt: 'fb-neg' }

describe('resolveDtParams', () => {
  it('saved params take the whole set, recommendation ignored', () => {
    const saved = { width: 1, height: 2, steps: 3, guidance: 4, seed: '5', negativePrompt: 'n' }
    expect(resolveDtParams(saved, { width: 999 }, FALLBACKS)).toEqual(saved)
  })

  it('recommendation fills per field over fallbacks, but never the seed', () => {
    const resolved = resolveDtParams(null, { width: 768, negativePrompt: 'rec-neg' }, { ...FALLBACKS, seed: '7' })
    expect(resolved.width).toBe(768)
    expect(resolved.height).toBe(512)
    expect(resolved.negativePrompt).toBe('rec-neg')
    // A recommended seed would make every user's output identical.
    expect(resolved.seed).toBe('7')
  })

  it('null recommendation fields fall through to fallbacks', () => {
    const resolved = resolveDtParams(null, { width: null, steps: null }, FALLBACKS)
    expect(resolved.width).toBe(512)
    expect(resolved.steps).toBe(4)
  })
})

describe('toDrawThingsTaskParams', () => {
  // Seed 0 and blanks mean "random" — matching main's own seed > 0 guard. The
  // column used to enqueue seed 0; the divergence lived exactly here.
  it('includes a seed only when it parses to a positive integer', () => {
    const base = { width: 1, height: 1, steps: 1, guidance: 1, negativePrompt: '' }
    expect(toDrawThingsTaskParams({ ...base, seed: '42' }).seed).toBe(42)
    expect(toDrawThingsTaskParams({ ...base, seed: '0' })).not.toHaveProperty('seed')
    expect(toDrawThingsTaskParams({ ...base, seed: '-3' })).not.toHaveProperty('seed')
    expect(toDrawThingsTaskParams({ ...base, seed: '' })).not.toHaveProperty('seed')
    expect(toDrawThingsTaskParams({ ...base, seed: 'random' })).not.toHaveProperty('seed')
  })

  it('cleans the negative prompt as a scalar and drops it when empty', () => {
    const base = { width: 1, height: 1, steps: 1, guidance: 1, seed: '' }
    expect(toDrawThingsTaskParams({ ...base, negativePrompt: 'a\nb' }).negativePrompt).toBe('a b')
    expect(toDrawThingsTaskParams({ ...base, negativePrompt: '   ' })).not.toHaveProperty('negativePrompt')
  })
})

describe('dtFallbacksFromSettings', () => {
  it('reads the configured defaults and falls back to the pre-load placeholders', () => {
    expect(dtFallbacksFromSettings(null)).toEqual({
      width: 1024, height: 1024, steps: 4, guidance: 1, seed: '', negativePrompt: '',
    })
    const settings = {
      image_backends: { drawthings: { default_params: { fallback_width: 640, seed: 9 } } },
    }
    const fallbacks = dtFallbacksFromSettings(settings)
    expect(fallbacks.width).toBe(640)
    expect(fallbacks.seed).toBe('9')
  })
})
