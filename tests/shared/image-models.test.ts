import { describe, expect, it } from 'vitest'
import {
  IMAGE_BACKEND_PROVIDERS,
  SUPPORTED_MODELS,
  findModel,
  getModelsForBackend,
  isImageModel,
} from '../../src/shared/ai-models'
import type { CloudBackendId, Task } from '../../src/shared/types'
import { CLOUD_BACKEND_IDS_IN_UI_ORDER } from '../../src/shared/types'
import { buildOpenAIImageParams } from '../../src/main/backends/openai-request'
import { buildGeminiImageRequest } from '../../src/main/backends/nanobanana-request'
import { buildXaiImageBody } from '../../src/main/backends/grok-request'
import { buildFluxBody } from '../../src/main/backends/flux-request'

// The image half of the routing guard: each row's provider, kind and default
// slot, and a request-builder branch for every row. The rows themselves come
// from the lineup research and are reviewed when the table changes.

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
  nanobanana: { aspectRatio: '1:1', imageSize: '1K', thinking: 'high' },
  grok: { aspectRatio: '1:1', resolution: '1k' },
  flux: { width: 1024, height: 1024, aspectRatio: '1:1', resolution: '1k' },
}

function imageTask(backend: CloudBackendId, model: string, params: Record<string, unknown>): Task {
  return {
    id: 't1', prompt: 'a cat', backend, model, params, status: 'queued',
    enqueuedAt: '2026-01-01T00:00:00.000Z', startedAt: null, completedAt: null, durationMs: null,
    imagePath: null, baseName: null, error: null, providerMessage: null,
  }
}

/** A request with the model id swapped out, so a row's request and an unlisted id's compare. */
function withoutModel(request: unknown): unknown {
  return JSON.parse(JSON.stringify(request, (key, value) => (key === 'model' ? undefined : value)))
}

describe('image routing guard', () => {
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

  it('finds a row only by its exact id', () => {
    for (const row of IMAGE_MODELS) expect(findModel(row.backend, row.id), row.id).toBe(row)
    expect(findModel('openai', 'unlisted-model')).toBeUndefined()
    expect(getModelsForBackend('drawthings')).toEqual([])
  })
})
