import { describe, expect, it } from 'vitest'
import { buildXaiImageBody } from '../../../src/main/backends/grok-request'
import type { Task } from '../../../src/shared/types'

function makeTask(model: string, params: Record<string, unknown>): Task {
  return {
    id: 't1', prompt: 'a cat', backend: 'grok', model, params, status: 'queued',
    enqueuedAt: '2026-01-01T00:00:00.000Z', startedAt: null, completedAt: null, durationMs: null,
    imagePath: null, baseName: null, error: null, providerMessage: null,
  }
}

const plain = { prompt: 'a cat', n: 1, response_format: 'b64_json' }

describe('buildXaiImageBody', () => {
  it('sends 2.0 its ratio, resolution and quality as chosen, auto included', () => {
    expect(buildXaiImageBody(makeTask('grok-imagine-image-2.0', { aspectRatio: 'auto', resolution: '1.5k', quality: 'auto' }))).toEqual({
      model: 'grok-imagine-image-2.0', ...plain, aspect_ratio: 'auto', resolution: '1.5k', quality: 'auto',
    })
    for (const quality of ['auto', 'low', 'medium']) {
      expect(buildXaiImageBody(makeTask('grok-imagine-image-2.0', { quality })).quality).toBe(quality)
    }
  })

  it('sends grok-imagine-image no quality', () => {
    expect(buildXaiImageBody(makeTask('grok-imagine-image', { aspectRatio: '21:9', resolution: '2k', quality: 'low' }))).toEqual({
      model: 'grok-imagine-image', ...plain, aspect_ratio: '21:9', resolution: '2k',
    })
  })

  it.each(['grok-imagine-image-quality', 'unlisted-model'])('sends %s, an id with no row, the plain request', (model) => {
    expect(buildXaiImageBody(makeTask(model, { aspectRatio: '1:1', resolution: '1k', quality: 'low' }))).toEqual({ model, ...plain })
  })
})
