import { ThinkingLevel } from '@google/genai'
import { describe, expect, it } from 'vitest'
import { buildGeminiImageRequest } from '../../../src/main/backends/nanobanana-request'
import { GEMINI_SAFETY_SETTINGS } from '../../../src/main/text-ai/request'
import { getModelsForBackend } from '../../../src/shared/ai-models'
import type { Task } from '../../../src/shared/types'

function makeTask(model: string, params: Record<string, unknown>): Task {
  return {
    id: 't1', prompt: 'a cat', backend: 'nanobanana', model, params, status: 'queued',
    enqueuedAt: '2026-01-01T00:00:00.000Z', startedAt: null, completedAt: null, durationMs: null,
    imagePath: null, baseName: null, error: null,
  }
}

describe('buildGeminiImageRequest', () => {
  it('sends the ratio, size and thinking as chosen, with every harm category off', () => {
    expect(buildGeminiImageRequest(makeTask('gemini-3.1-flash-image', { aspectRatio: '8:1', imageSize: '512', thinking: 'high' }))).toEqual({
      model: 'gemini-3.1-flash-image',
      contents: 'a cat',
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        safetySettings: GEMINI_SAFETY_SETTINGS,
        imageConfig: { aspectRatio: '8:1', imageSize: '512' },
        thinkingConfig: { thinkingLevel: 'HIGH' },
      },
    })
  })

  it('sends every thinking level each row lists, the default included', () => {
    for (const row of getModelsForBackend('nanobanana')) {
      for (const level of row.thinking) {
        const config = buildGeminiImageRequest(makeTask(row.id, { aspectRatio: '1:1', imageSize: '1K', thinking: level })).config
        expect(config.thinkingConfig, `${row.id}/${level}`).toEqual({ thinkingLevel: level.toUpperCase() })
        expect(Object.values(ThinkingLevel)).toContain(level.toUpperCase())
      }
    }
  })

  it('sends a task that carries no choices the defaults: 1:1, 1K and the row\'s own thinking', () => {
    expect(buildGeminiImageRequest(makeTask('gemini-3-pro-image', {})).config).toMatchObject({
      imageConfig: { aspectRatio: '1:1', imageSize: '1K' }, thinkingConfig: { thinkingLevel: 'MEDIUM' },
    })
    expect(buildGeminiImageRequest(makeTask('gemini-3.1-flash-lite-image', { thinking: '' })).config.thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' })
  })

  it.each(['gemini-2.5-flash-image', 'unlisted-model'])('sends %s, an id with no row, the plain request with the safety settings', (model) => {
    expect(buildGeminiImageRequest(makeTask(model, { aspectRatio: '16:9', imageSize: '2K', thinking: 'high' })).config).toEqual({
      responseModalities: ['TEXT', 'IMAGE'], safetySettings: GEMINI_SAFETY_SETTINGS,
    })
  })
})
