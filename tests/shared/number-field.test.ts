import { describe, expect, it } from 'vitest'
import {
  ADVANCED_ITERATIONS_RULE, AUTO_PREVIEW_SECONDS_RULE, DRAW_THINGS_DIMENSION_RULE, DRAW_THINGS_GUIDANCE_RULE,
  OPENAI_COMPRESSION_RULE, OPENAI_DIMENSION_RULE, meetsTaskNumberRules, parseNumberText,
} from '../../src/shared/number-field'

describe('parseNumberText', () => {
  it('reads only text that is wholly a number the rule accepts', () => {
    expect(parseNumberText(' 12 ', AUTO_PREVIEW_SECONDS_RULE)).toBe(12)
    expect(parseNumberText('0', AUTO_PREVIEW_SECONDS_RULE)).toBe(0)
    for (const text of ['', ' ', '2.5', '12px', '-1', '1e3', 'x']) expect(parseNumberText(text, AUTO_PREVIEW_SECONDS_RULE), text).toBeNull()
  })

  it('takes fractions only where the rule allows them', () => {
    expect(parseNumberText('3.5', DRAW_THINGS_GUIDANCE_RULE)).toBe(3.5)
    expect(parseNumberText('.5', DRAW_THINGS_GUIDANCE_RULE)).toBe(0.5)
    expect(parseNumberText('3.5', ADVANCED_ITERATIONS_RULE)).toBeNull()
  })

  it('takes only multiples of the step, inside the range', () => {
    expect(parseNumberText('64', DRAW_THINGS_DIMENSION_RULE)).toBe(64)
    // No maximum: Draw Things owns its own limits.
    expect(parseNumberText('8192', DRAW_THINGS_DIMENSION_RULE)).toBe(8192)
    expect(parseNumberText('1000', DRAW_THINGS_DIMENSION_RULE)).toBeNull()
    expect(parseNumberText('0', DRAW_THINGS_DIMENSION_RULE)).toBeNull()
    expect(parseNumberText('3840', OPENAI_DIMENSION_RULE)).toBe(3840)
    expect(parseNumberText('3856', OPENAI_DIMENSION_RULE)).toBeNull()
    expect(parseNumberText('496', OPENAI_DIMENSION_RULE)).toBeNull()
    expect(parseNumberText('100', OPENAI_COMPRESSION_RULE)).toBe(100)
    expect(parseNumberText('101', OPENAI_COMPRESSION_RULE)).toBeNull()
    expect(parseNumberText('9999', ADVANCED_ITERATIONS_RULE)).toBe(9999)
    expect(parseNumberText('10000', ADVANCED_ITERATIONS_RULE)).toBeNull()
  })
})

describe('meetsTaskNumberRules', () => {
  it('checks the numbers each column queues against the rules its fields use', () => {
    expect(meetsTaskNumberRules('drawthings', 'm.ckpt', { width: 1024, height: 768, steps: 200, guidance: 0 })).toBe(true)
    expect(meetsTaskNumberRules('drawthings', 'm.ckpt', { width: 1000, height: 768, steps: 20, guidance: 1 })).toBe(false)
    expect(meetsTaskNumberRules('drawthings', 'm.ckpt', { width: 1024, height: 768, steps: 0, guidance: 1 })).toBe(false)
    expect(meetsTaskNumberRules('openai', 'gpt-image-2', { width: 1024, height: 1024 })).toBe(true)
    expect(meetsTaskNumberRules('openai', 'gpt-image-2', { width: 1024, height: 1024, outputCompression: 120 })).toBe(false)
    expect(meetsTaskNumberRules('openai', 'gpt-image-2', { width: 1000, height: 1024 })).toBe(false)
    expect(meetsTaskNumberRules('openai', 'not-in-the-list', {})).toBe(true)
    expect(meetsTaskNumberRules('flux', 'flux-2-flex', { steps: 50, guidance: 1.5 })).toBe(true)
    expect(meetsTaskNumberRules('flux', 'flux-2-flex', { steps: 51, guidance: 5 })).toBe(false)
    expect(meetsTaskNumberRules('flux', 'flux-2-pro', {})).toBe(true)
  })
})
