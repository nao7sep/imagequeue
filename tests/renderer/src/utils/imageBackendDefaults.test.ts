import { describe, expect, it } from 'vitest'
import {
  normalizeOpenAiDimension,
  resolveOpenAiSize,
  resolveSavedImageBackendDefaults,
  serializeImageBackendDefaults
} from '../../../../src/renderer/src/utils/imageBackendDefaults'
import {
  findModel,
  OPENAI_GPT2_MAX_EDGE,
  OPENAI_GPT2_MIN_EDGE,
  OPENAI_GPT2_SIZE_STEP,
  OPENAI_MODELS,
  FLUX_MODELS
} from '../../../../src/shared/models'

describe('normalizeOpenAiDimension', () => {
  it('snaps to the 16px step', () => {
    expect(normalizeOpenAiDimension(1000) % OPENAI_GPT2_SIZE_STEP).toBe(0)
    expect(normalizeOpenAiDimension(1024)).toBe(1024)
  })

  it('clamps below the minimum and above the maximum edge', () => {
    expect(normalizeOpenAiDimension(100)).toBe(OPENAI_GPT2_MIN_EDGE)
    expect(normalizeOpenAiDimension(99999)).toBe(OPENAI_GPT2_MAX_EDGE)
  })

  it('falls back to the minimum edge for non-finite input', () => {
    expect(normalizeOpenAiDimension(NaN)).toBe(OPENAI_GPT2_MIN_EDGE)
    expect(normalizeOpenAiDimension(Infinity)).toBe(OPENAI_GPT2_MIN_EDGE)
  })
})

describe('resolveOpenAiSize', () => {
  const fixedModel = findModel('openai', 'gpt-image-1')!     // supportsCustomSizes falsy
  const customModel = findModel('openai', 'gpt-image-2')!    // supportsCustomSizes true

  it('keeps a matching preset and falls back to sizes[0] otherwise (fixed-size model)', () => {
    const preset = fixedModel.sizes[1] // a rect preset
    expect(resolveOpenAiSize(fixedModel, preset.width, preset.height))
      .toEqual({ width: preset.width, height: preset.height })
    expect(resolveOpenAiSize(fixedModel, 999, 999))
      .toEqual({ width: fixedModel.sizes[0].width, height: fixedModel.sizes[0].height })
  })

  it('normalizes arbitrary dimensions for a custom-size model', () => {
    expect(resolveOpenAiSize(customModel, 2050, 100))
      .toEqual({ width: normalizeOpenAiDimension(2050), height: OPENAI_GPT2_MIN_EDGE })
  })

  it('falls back to sizes[0] when a custom-size model gets non-numeric input', () => {
    expect(resolveOpenAiSize(customModel, 'x', null))
      .toEqual({ width: customModel.sizes[0].width, height: customModel.sizes[0].height })
  })
})

describe('serializeImageBackendDefaults', () => {
  it('serializes model and params to JSON', () => {
    expect(serializeImageBackendDefaults('gpt-image-2', { quality: 'high' }))
      .toBe('{"model":"gpt-image-2","params":{"quality":"high"}}')
  })
})

describe('resolveSavedImageBackendDefaults', () => {
  it('returns null without backend settings', () => {
    expect(resolveSavedImageBackendDefaults('openai', null, OPENAI_MODELS, OPENAI_MODELS[0])).toBeNull()
  })

  it('validates a saved OpenAI quality and clamps the saved width', () => {
    const result = resolveSavedImageBackendDefaults(
      'openai',
      { model: 'gpt-image-2', default_params: { quality: 'bogus', width: 100, height: 100 } },
      OPENAI_MODELS,
      findModel('openai', 'gpt-image-2')
    )!
    // Invalid quality falls back to 'auto'; out-of-range dims clamp to the min edge.
    expect(result.params.quality).toBe('auto')
    expect(result.params.width).toBe(OPENAI_GPT2_MIN_EDGE)
    expect(result.params.height).toBe(OPENAI_GPT2_MIN_EDGE)
  })

  it('clamps a saved FLUX Flex step count into the allowed range', () => {
    const flex = findModel('flux', 'flux-2-flex')!
    const result = resolveSavedImageBackendDefaults(
      'flux',
      { model: 'flux-2-flex', default_params: { steps: 9999 } },
      FLUX_MODELS,
      flex
    )!
    expect(result.params.steps).toBe(flex.stepsRange!.max)
  })
})
