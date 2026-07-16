import { describe, expect, it } from 'vitest'
import { buildOpenAIImageParams, validateGptImage2Size } from '../../../src/main/backends/openai-request'
import type { Task } from '../../../src/shared/types'

function makeTask(params: Record<string, unknown>, model = 'gpt-image-1'): Task {
  return {
    id: 't1',
    prompt: 'a cat',
    backend: 'openai',
    model,
    params,
    status: 'queued',
    enqueuedAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    durationMs: null,
    imagePath: null,
    baseName: null,
    error: null,
  }
}

describe('buildOpenAIImageParams', () => {
  it('applies defaults when params are empty', () => {
    const p = buildOpenAIImageParams(makeTask({}))
    expect(p.model).toBe('gpt-image-1')
    expect(p.size).toBe('1024x1024')
    expect(p.output_format).toBe('png')
    // Default-valued optional fields are omitted, not sent.
    expect('moderation' in p).toBe(false)
    expect('quality' in p).toBe(false)
    expect('background' in p).toBe(false)
    expect('output_compression' in p).toBe(false)
  })

  it('does not include the envelope fields (prompt/n/stream) — openai.ts adds those', () => {
    const p = buildOpenAIImageParams(makeTask({}))
    expect('prompt' in p).toBe(false)
    expect('n' in p).toBe(false)
    expect('stream' in p).toBe(false)
  })

  it('builds the size string from width/height', () => {
    const p = buildOpenAIImageParams(makeTask({ width: 1536, height: 1024 }))
    expect(p.size).toBe('1536x1024')
  })

  it('omits moderation when auto, includes it otherwise', () => {
    expect('moderation' in buildOpenAIImageParams(makeTask({ moderation: 'auto' }))).toBe(false)
    expect(buildOpenAIImageParams(makeTask({ moderation: 'low' })).moderation).toBe('low')
  })

  it('omits quality when auto, includes it otherwise', () => {
    expect('quality' in buildOpenAIImageParams(makeTask({ quality: 'auto' }))).toBe(false)
    expect(buildOpenAIImageParams(makeTask({ quality: 'high' })).quality).toBe('high')
  })

  it('omits background when opaque, includes it otherwise', () => {
    expect('background' in buildOpenAIImageParams(makeTask({ background: 'opaque' }))).toBe(false)
    expect(buildOpenAIImageParams(makeTask({ background: 'transparent' })).background).toBe('transparent')
    expect(buildOpenAIImageParams(makeTask({ background: 'auto' })).background).toBe('auto')
  })

  it('includes output_compression only when set, including zero', () => {
    expect('output_compression' in buildOpenAIImageParams(makeTask({}))).toBe(false)
    expect(buildOpenAIImageParams(makeTask({ outputCompression: 80 })).output_compression).toBe(80)
    // 0 is a real value, not "unset" — must be included.
    expect(buildOpenAIImageParams(makeTask({ outputCompression: 0 })).output_compression).toBe(0)
  })

  it('passes output_format through', () => {
    expect(buildOpenAIImageParams(makeTask({ outputFormat: 'jpeg' })).output_format).toBe('jpeg')
    expect(buildOpenAIImageParams(makeTask({ outputFormat: 'webp' })).output_format).toBe('webp')
  })

  it('validates size for gpt-image-2 and rejects an invalid one', () => {
    expect(() => buildOpenAIImageParams(makeTask({ width: 1000, height: 1024 }, 'gpt-image-2'))).toThrow()
  })

  it('accepts a large custom size for gpt-image-2', () => {
    const p = buildOpenAIImageParams(makeTask({ width: 2048, height: 2048 }, 'gpt-image-2'))
    expect(p.size).toBe('2048x2048')
  })

  it('does not validate size for non-gpt-image-2 models', () => {
    // Same off-grid size that throws for gpt-image-2 is accepted for gpt-image-1.
    const p = buildOpenAIImageParams(makeTask({ width: 1000, height: 1024 }, 'gpt-image-1'))
    expect(p.size).toBe('1000x1024')
  })
})

describe('validateGptImage2Size', () => {
  it('accepts a valid size', () => {
    expect(() => validateGptImage2Size(1024, 1024)).not.toThrow()
    expect(() => validateGptImage2Size(2048, 1024)).not.toThrow()
  })

  it('rejects non-integer dimensions', () => {
    expect(() => validateGptImage2Size(1024.5, 1024)).toThrow(/whole-number/)
  })

  it('rejects dimensions below the minimum edge', () => {
    expect(() => validateGptImage2Size(256, 1024)).toThrow(/at least/)
  })

  it('rejects dimensions above the maximum edge', () => {
    expect(() => validateGptImage2Size(4096, 1024)).toThrow(/must not exceed/)
  })

  it('rejects dimensions that are not multiples of the size step', () => {
    expect(() => validateGptImage2Size(1000, 1024)).toThrow(/multiples of/)
  })

  it('rejects an aspect ratio beyond the limit', () => {
    // 512x2048 = 4:1, exceeds the 3:1 cap (both edges valid multiples in range).
    expect(() => validateGptImage2Size(512, 2048)).toThrow(/aspect ratio/)
  })

  it('rejects a total pixel count above the cap', () => {
    // 3840x2176: edges in range, multiples of 16, ratio < 3, but > 8.29M pixels.
    expect(() => validateGptImage2Size(3840, 2176)).toThrow(/pixels/)
  })
})
