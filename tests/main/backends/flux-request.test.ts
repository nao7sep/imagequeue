import { describe, expect, it } from 'vitest'
import { buildFluxBody } from '../../../src/main/backends/flux-request'
import type { Task } from '../../../src/shared/types'

function makeTask(model: string, params: Record<string, unknown>): Task {
  return {
    id: 't1', prompt: 'a cat', backend: 'flux', model, params, status: 'queued',
    enqueuedAt: '2026-01-01T00:00:00.000Z', startedAt: null, completedAt: null, durationMs: null,
    imagePath: null, baseName: null, error: null,
  }
}

describe('buildFluxBody', () => {
  it('sends FLUX 3 its ratio and resolution as chosen with safety 4, and no size, seed or format', () => {
    expect(buildFluxBody(makeTask('flux-3-image', { aspectRatio: 'auto', resolution: '768sq', width: 1024, seed: 7, outputFormat: 'png' }))).toEqual({
      prompt: 'a cat', aspect_ratio: 'auto', resolution: '768sq', safety_tolerance: 4,
    })
    expect(buildFluxBody(makeTask('flux-3-image', {}))).toEqual({ prompt: 'a cat', aspect_ratio: '1:1', resolution: '1k', safety_tolerance: 4 })
  })

  it.each(['flux-2-max', 'flux-2-pro', 'flux-2-klein-9b', 'flux-2-klein-4b'])('sends %s its size, format and seed with safety 5', (model) => {
    expect(buildFluxBody(makeTask(model, { width: 512, height: 512, outputFormat: 'webp', seed: 7 }))).toEqual({
      prompt: 'a cat', width: 512, height: 512, output_format: 'webp', safety_tolerance: 5, seed: 7,
    })
    // png, the default, is still sent; no seed means BFL picks one.
    expect(buildFluxBody(makeTask(model, { width: 1024, height: 1024, outputFormat: 'png', seed: null }))).toEqual({
      prompt: 'a cat', width: 1024, height: 1024, output_format: 'png', safety_tolerance: 5,
    })
  })

  it('sends Flex its steps and guidance too, and never prompt upsampling', () => {
    const body = buildFluxBody(makeTask('flux-2-flex', { width: 1024, height: 1024, outputFormat: 'jpeg', steps: 50, guidance: 5 }))
    expect(body).toEqual({ prompt: 'a cat', width: 1024, height: 1024, output_format: 'jpeg', safety_tolerance: 5, steps: 50, guidance: 5 })
    expect(body).not.toHaveProperty('prompt_upsampling')
  })

  it('refuses a FLUX.2 size off the grid or over 4MP', () => {
    expect(() => buildFluxBody(makeTask('flux-2-pro', { width: 1000, height: 1024 }))).toThrow(/multiples/)
    expect(() => buildFluxBody(makeTask('flux-2-pro', { width: 4096, height: 2048 }))).toThrow(/4MP/)
  })

  it.each(['flux-2-pro-preview', 'unlisted-model'])('sends %s, an id with no row, the prompt alone', (model) => {
    expect(buildFluxBody(makeTask(model, { width: 1024, height: 1024, outputFormat: 'png', seed: 7 }))).toEqual({ prompt: 'a cat' })
  })
})
