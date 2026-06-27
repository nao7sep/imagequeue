import { describe, expect, it } from 'vitest'
import {
  findRecommendedSettings,
  parseRecommendationBytes,
  prefixFor,
  recommendedParamsFromMatch,
  versionForModel,
  type RecommendationSpec
} from '../../src/main/recommendation-match'

function spec(name: string, configuration: Record<string, unknown>, extra: Partial<RecommendationSpec> = {}): RecommendationSpec {
  return { name, configuration, ...extra }
}

describe('prefixFor (quant-suffix stripping)', () => {
  it('strips the file extension and known quant suffixes', () => {
    expect(prefixFor('flux_1_dev_q8p.ckpt')).toBe('flux_1_dev')
    expect(prefixFor('flux_1_dev_f16_q6p.ckpt')).toBe('flux_1_dev')
    // Only the extension and trailing quant suffixes are stripped; "v0.9" stays.
    expect(prefixFor('sdxl_base_v0.9.ckpt')).toBe('sdxl_base_v0.9')
  })

  it('leaves a name without quant suffixes intact and handles empty', () => {
    expect(prefixFor('qwen_image.ckpt')).toBe('qwen_image')
    expect(prefixFor('')).toBe('')
  })
})

describe('versionForModel', () => {
  it('maps known model families', () => {
    expect(versionForModel('flux_1_dev_q8p.ckpt')).toBe('flux1')
    expect(versionForModel('qwen_image_q6p.ckpt')).toBe('qwen_image')
    expect(versionForModel('sdxl_base_v0.9_f16.ckpt')).toBe('sdxl_base_v0.9')
  })

  it('returns null for an unknown family', () => {
    expect(versionForModel('totally_unknown_model.ckpt')).toBeNull()
  })
})

describe('findRecommendedSettings — match cascade', () => {
  it('prefers an exact configuration.model match', () => {
    const specs = [
      spec('prefix-one', { model: 'flux_1_dev_other.ckpt' }),
      spec('exact-one', { model: 'flux_1_dev_q8p.ckpt' })
    ]
    const match = findRecommendedSettings('flux_1_dev_q8p.ckpt', specs)
    expect(match).toEqual({ spec: specs[1], type: 'exact' })
  })

  it('falls back to a prefix match when no exact model exists', () => {
    const specs = [spec('prefix-one', { model: 'flux_1_dev_f16.ckpt' })]
    // Same prefix (flux_1_dev) after quant-suffix stripping, different file.
    const match = findRecommendedSettings('flux_1_dev_q8p.ckpt', specs)
    expect(match).toEqual({ spec: specs[0], type: 'prefix' })
  })

  it('falls back to a prefix-parent match (the model is a child of the config prefix)', () => {
    const specs = [spec('parent', { model: 'flux_1.ckpt' })]
    // model prefix "flux_1_dev" starts with config prefix "flux_1_".
    const match = findRecommendedSettings('flux_1_dev.ckpt', specs)
    expect(match).toEqual({ spec: specs[0], type: 'prefix-parent' })
  })

  it('falls back to a version match when nothing else fits', () => {
    const specs = [spec('by-version', { model: 'unrelated.ckpt' }, { version: 'flux1' })]
    const match = findRecommendedSettings('flux_1_dev_q8p.ckpt', specs)
    expect(match).toEqual({ spec: specs[0], type: 'version' })
  })

  it('returns null when nothing matches', () => {
    const specs = [spec('x', { model: 'totally_other.ckpt' })]
    expect(findRecommendedSettings('totally_unknown_xyz.ckpt', specs)).toBeNull()
  })
})

describe('recommendedParamsFromMatch (projection)', () => {
  it('projects numeric config fields and trims the negative prompt', () => {
    const match = {
      spec: spec('My Model', {
        model: 'flux_1_dev.ckpt',
        width: 1024,
        height: 768,
        steps: 20,
        guidanceScale: 3.5
      }, { negative: '  blurry, low quality  ' }),
      type: 'exact' as const
    }
    expect(recommendedParamsFromMatch(match)).toEqual({
      width: 1024,
      height: 768,
      steps: 20,
      guidance: 3.5,
      negativePrompt: 'blurry, low quality',
      matchName: 'My Model',
      matchModel: 'flux_1_dev.ckpt',
      matchType: 'exact'
    })
  })

  it('nulls out non-numeric/non-string fields', () => {
    const match = {
      spec: spec('Bare', { model: 42, width: 'wide' }),
      type: 'version' as const
    }
    const params = recommendedParamsFromMatch(match)
    expect(params.width).toBeNull()
    expect(params.matchModel).toBeNull()
    expect(params.negativePrompt).toBeNull()
  })
})

describe('parseRecommendationBytes', () => {
  it('keeps only well-formed spec entries', () => {
    const data = Buffer.from(JSON.stringify([
      { name: 'ok', configuration: { model: 'a' } },
      { name: 'no-config' },
      { configuration: {} },
      { name: 'bad-config', configuration: [] },
      'not an object'
    ]))
    const specs = parseRecommendationBytes(data)
    expect(specs.map((s) => s.name)).toEqual(['ok'])
  })

  it('returns an empty array for non-array JSON', () => {
    expect(parseRecommendationBytes(Buffer.from('{}'))).toEqual([])
  })
})
