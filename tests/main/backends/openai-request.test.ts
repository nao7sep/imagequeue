import { describe, expect, it } from 'vitest'
import { buildOpenAIImageParams, validateGptImageSize } from '../../../src/main/backends/openai-request'
import type { Task } from '../../../src/shared/types'
import { columnParams } from './column-params'

// A task as a column at its defaults queues it, with `params` chosen on top.
function makeTask(params: Record<string, unknown>, model = 'gpt-image-2.5-flare'): Task {
  return {
    id: 't1',
    prompt: 'a cat',
    backend: 'openai',
    model,
    params: { ...columnParams('openai', model), ...params },
    status: 'queued',
    enqueuedAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    durationMs: null,
    imagePath: null,
    baseName: null,
    error: null,
    providerMessage: null,
  }
}

describe('buildOpenAIImageParams', () => {
  it.each(['gpt-image-2.5-flare', 'gpt-image-2'])('sends %s every field as chosen, auto and opaque included, and moderation low', (model) => {
    expect(buildOpenAIImageParams(makeTask({ width: 1536, height: 1024, quality: 'auto', outputFormat: 'png', background: 'opaque' }, model))).toEqual({
      model, size: '1536x1024', quality: 'auto', background: 'opaque', output_format: 'png', moderation: 'low',
    })
  })

  it('sends each value a row lists as chosen', () => {
    for (const quality of ['auto', 'low', 'medium', 'high', 'xhigh', 'max']) {
      expect(buildOpenAIImageParams(makeTask({ quality })).quality).toBe(quality)
    }
    for (const background of ['auto', 'transparent', 'opaque']) {
      expect(buildOpenAIImageParams(makeTask({ background })).background).toBe(background)
    }
    for (const outputFormat of ['png', 'jpeg', 'webp']) {
      expect(buildOpenAIImageParams(makeTask({ outputFormat })).output_format).toBe(outputFormat)
    }
  })

  it('sends compression for jpeg and webp only, zero included', () => {
    expect(buildOpenAIImageParams(makeTask({ outputFormat: 'png', outputCompression: 80 }))).not.toHaveProperty('output_compression')
    expect(buildOpenAIImageParams(makeTask({ outputFormat: 'jpeg', outputCompression: 80 })).output_compression).toBe(80)
    expect(buildOpenAIImageParams(makeTask({ outputFormat: 'webp', outputCompression: 0 })).output_compression).toBe(0)
    expect(buildOpenAIImageParams(makeTask({ outputFormat: 'webp', outputCompression: 100 })).output_compression).toBe(100)
  })

  it('does not include the envelope fields (prompt/n/stream) — openai.ts adds those', () => {
    const p = buildOpenAIImageParams(makeTask({}))
    expect('prompt' in p).toBe(false)
    expect('n' in p).toBe(false)
    expect('stream' in p).toBe(false)
  })

  it.each(['gpt-image-2.5-flare', 'gpt-image-2'])('validates the custom-size rule for %s', (model) => {
    expect(() => buildOpenAIImageParams(makeTask({ width: 1000, height: 1024 }, model))).toThrow()
    expect(buildOpenAIImageParams(makeTask({ width: 2048, height: 2048 }, model)).size).toBe('2048x2048')
  })

  it.each(['gpt-image-1', 'gpt-image-1.5', 'gpt-image-1-mini', 'unlisted-model'])('sends %s, an id with no row, the plain request: the model alone', (model) => {
    expect(buildOpenAIImageParams(makeTask({ width: 1000, height: 1024, quality: 'high', background: 'opaque' }, model))).toEqual({ model })
  })
})

describe('validateGptImageSize', () => {
  it('accepts a valid size', () => {
    expect(() => validateGptImageSize(1024, 1024)).not.toThrow()
    expect(() => validateGptImageSize(2048, 1024)).not.toThrow()
  })

  it('rejects non-integer dimensions', () => {
    expect(() => validateGptImageSize(1024.5, 1024)).toThrow(/whole-number/)
  })

  it('rejects a total pixel count below the floor (not a per-edge minimum)', () => {
    // The real OpenAI rule is a minimum TOTAL pixel count (655,360), not a min edge.
    // 512x512 = 262,144 px: valid 1:1 ratio, both edges multiples of 16 and in range,
    // yet rejected for too few pixels. 1024x512 = 524,288 px is the exact case the
    // old "512px min edge" rule wrongly accepted.
    expect(() => validateGptImageSize(512, 512)).toThrow(/at least .* pixels total/)
    expect(() => validateGptImageSize(1024, 512)).toThrow(/at least .* pixels total/)
    // Just above the floor is accepted: 1024x1024 = 1,048,576 px.
    expect(() => validateGptImageSize(1024, 1024)).not.toThrow()
  })

  it('rejects dimensions above the maximum edge', () => {
    expect(() => validateGptImageSize(4096, 1024)).toThrow(/must not exceed/)
  })

  it('rejects dimensions that are not multiples of the size step', () => {
    expect(() => validateGptImageSize(1000, 1024)).toThrow(/multiples of/)
  })

  it('rejects an aspect ratio beyond the limit', () => {
    // 512x2048 = 4:1, exceeds the 3:1 cap (both edges valid multiples in range).
    expect(() => validateGptImageSize(512, 2048)).toThrow(/aspect ratio/)
  })

  it('rejects a total pixel count above the cap', () => {
    // 3840x2176: edges in range, multiples of 16, ratio < 3, but > 8.29M pixels.
    expect(() => validateGptImageSize(3840, 2176)).toThrow(/at or below/)
  })
})
