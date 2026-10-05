import { describe, expect, it } from 'vitest'
import {
  IMAGE_BACKEND_PROVIDERS,
  SUPPORTED_MODELS,
  findModel,
  getDefaultModelForBackend,
  getModelsForBackend,
  isImageModel,
} from '../../src/shared/ai-models'
import type { CloudBackendId, Task } from '../../src/shared/types'
import { FLUX_SIZES, STANDARD_SIZE_PRESETS } from '../../src/shared/models'
import { CLOUD_BACKEND_IDS_IN_UI_ORDER } from '../../src/shared/types'
import { buildOpenAIImageParams } from '../../src/main/backends/openai-request'
import { buildGeminiImageRequest } from '../../src/main/backends/nanobanana-request'
import { buildXaiImageBody } from '../../src/main/backends/grok-request'
import { buildFluxBody } from '../../src/main/backends/flux-request'

// The image half of the routing guard: the rows each column offers, in order,
// with their defaults, and a request-builder branch for every row.

const IMAGE_MODELS = SUPPORTED_MODELS.filter(isImageModel)

const BUILDERS: Record<CloudBackendId, (task: Task) => unknown> = {
  openai: buildOpenAIImageParams,
  nanobanana: buildGeminiImageRequest,
  grok: buildXaiImageBody,
  flux: buildFluxBody,
}

// Params every row of the backend takes, so a branch has something to send.
const SAMPLE_PARAMS: Record<CloudBackendId, Record<string, unknown>> = {
  openai: { width: 1024, height: 1024 },
  nanobanana: { aspectRatio: '1:1', imageSize: '1K' },
  grok: { aspectRatio: '1:1', resolution: '1k' },
  flux: { width: 1024, height: 1024, aspectRatio: '1:1', resolution: '1k' },
}

function imageTask(backend: CloudBackendId, model: string, params: Record<string, unknown>): Task {
  return {
    id: 't1', prompt: 'a cat', backend, model, params, status: 'queued',
    enqueuedAt: '2026-01-01T00:00:00.000Z', startedAt: null, completedAt: null, durationMs: null,
    imagePath: null, baseName: null, error: null,
  }
}

/** A request with the model id swapped out, so a row's request and an unlisted id's compare. */
function withoutModel(request: unknown): unknown {
  return JSON.parse(JSON.stringify(request, (key, value) => (key === 'model' ? undefined : value)))
}

describe('image routing guard', () => {
  it('pins every column\'s rows, in order, and its default', () => {
    expect(Object.fromEntries(CLOUD_BACKEND_IDS_IN_UI_ORDER.map((backend) => [backend, getModelsForBackend(backend).map((row) => row.id)]))).toEqual({
      openai: ['gpt-image-2.5-flare', 'gpt-image-2'],
      nanobanana: ['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image'],
      grok: ['grok-imagine-image-2.0', 'grok-imagine-image'],
      flux: ['flux-3-image', 'flux-2-max', 'flux-2-pro', 'flux-2-flex', 'flux-2-klein-9b', 'flux-2-klein-4b'],
    })
    expect(Object.fromEntries(CLOUD_BACKEND_IDS_IN_UI_ORDER.map((backend) => [backend, getDefaultModelForBackend(backend)?.id]))).toEqual({
      openai: 'gpt-image-2.5-flare',
      nanobanana: 'gemini-3.1-flash-image',
      grok: 'grok-imagine-image-2.0',
      flux: 'flux-3-image',
    })
  })

  it('keys every image row by its api-key provider and the generate kind, with one default per provider', () => {
    for (const row of IMAGE_MODELS) {
      expect(row.provider, row.id).toBe(IMAGE_BACKEND_PROVIDERS[row.backend as CloudBackendId])
      expect(row.kinds, row.id).toEqual(['image-generate'])
    }
    for (const backend of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
      expect(getModelsForBackend(backend).filter((row) => row.defaultFor.includes('image-generate')), backend).toHaveLength(1)
    }
  })

  it('gives every image row its own branch, beyond the plain request an unlisted id gets', () => {
    for (const row of IMAGE_MODELS) {
      const backend = row.backend as CloudBackendId
      const build = BUILDERS[backend]
      const params = SAMPLE_PARAMS[backend]
      expect(withoutModel(build(imageTask(backend, row.id, params))), row.id)
        .not.toEqual(withoutModel(build(imageTask(backend, 'unlisted-model', params))))
    }
  })

  it('pins each OpenAI row\'s choice lists in order', () => {
    expect(getModelsForBackend('openai').map(({ id, qualities, backgrounds, outputFormats }) => [id, qualities, backgrounds, outputFormats])).toEqual([
      ['gpt-image-2.5-flare', ['auto', 'low', 'medium', 'high', 'xhigh', 'max'], ['auto', 'transparent', 'opaque'], ['png', 'jpeg', 'webp']],
      ['gpt-image-2', ['auto', 'low', 'medium', 'high'], ['auto', 'transparent', 'opaque'], ['png', 'jpeg', 'webp']],
    ])
    for (const row of getModelsForBackend('openai')) expect(row.sizes, row.id).toBe(STANDARD_SIZE_PRESETS)
  })

  it('pins each Gemini row\'s ratios, sizes and thinking in order, with its default', () => {
    const base = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
    const all = ['1:1', '1:4', '4:1', '1:8', '8:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
    expect(getModelsForBackend('nanobanana').map(({ id, aspectRatios, imageSizes, thinking, defaultThinking }) =>
      [id, aspectRatios.map((item) => item.value), imageSizes.map((item) => item.value), thinking, defaultThinking])).toEqual([
      ['gemini-3-pro-image', base, ['1K', '2K', '4K'], ['minimal', 'low', 'medium', 'high'], 'medium'],
      ['gemini-3.1-flash-image', all, ['512', '1K', '2K', '4K'], ['minimal', 'high'], 'minimal'],
      ['gemini-3.1-flash-lite-image', all, ['1K'], ['minimal', 'high'], 'minimal'],
    ])
  })

  it('pins each xAI row\'s ratios, resolutions and qualities in order', () => {
    const ratios = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1', '1:2', '19.5:9', '9:19.5', '20:9', '9:20', '21:9', '5:2']
    expect(getModelsForBackend('grok').map(({ id, aspectRatios, resolutions, qualities }) =>
      [id, aspectRatios.map((item) => item.value), resolutions.map((item) => item.value), qualities?.map((item) => item.value)])).toEqual([
      ['grok-imagine-image-2.0', ratios, ['1k', '1.5k', '2k'], ['auto', 'low', 'medium']],
      ['grok-imagine-image', ratios, ['1k', '2k'], undefined],
    ])
  })

  it('pins each FLUX row\'s fields in order', () => {
    const [flux3, ...flux2] = getModelsForBackend('flux')
    expect(flux3!.aspectRatios!.map((item) => item.value)).toEqual(['auto', '21:9', '2:1', '16:9', '3:2', '7:5', '4:3', '5:4', '1:1', '4:5', '3:4', '5:7', '2:3', '9:16', '1:2', '9:21'])
    expect(flux3!.resolutions!.map((item) => item.value)).toEqual(['768sq', '1k', '1.5k', '2k', '4k'])
    expect([flux3!.sizes, flux3!.outputFormats]).toEqual([undefined, undefined])
    for (const row of flux2) {
      expect(row.outputFormats, row.id).toEqual(['png', 'jpeg', 'webp'])
      expect(row.sizes, row.id).toBe(FLUX_SIZES)
      expect(row.aspectRatios, row.id).toBeUndefined()
      expect([row.stepsRange, row.guidanceRange], row.id).toEqual(row.id === 'flux-2-flex'
        ? [{ min: 1, max: 50, default: 50 }, { min: 1.5, max: 10, default: 5 }] : [undefined, undefined])
    }
  })

  it('treats a removed image id as an id not in the list', () => {
    expect(findModel('grok', 'grok-imagine-image-quality')).toBeUndefined()
    for (const id of ['gpt-image-1.5', 'gpt-image-1-mini']) expect(findModel('openai', id), id).toBeUndefined()
    expect(findModel('nanobanana', 'gemini-2.5-flash-image')).toBeUndefined()
  })

  it('finds a row only by its exact id', () => {
    expect(findModel('openai', 'gpt-image-2.5-flare')?.id).toBe('gpt-image-2.5-flare')
    expect(findModel('openai', 'unlisted-model')).toBeUndefined()
    expect(getModelsForBackend('drawthings')).toEqual([])
  })
})
