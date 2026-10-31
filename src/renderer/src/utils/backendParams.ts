import type { CloudBackendId } from '../../../shared/types'
import type { SavedImageBackendParams } from '../../../shared/image-backend-defaults'
import type {
  FluxModelDef,
  GrokModelDef,
  ModelDef,
  NanoBananaModelDef,
  OpenAIModelDef,
} from '../../../shared/models'
import { fluxBackend } from '../backends/flux'
import { grokBackend } from '../backends/grok'
import { nanoBananaBackend } from '../backends/nanobanana'
import { openaiBackend } from '../backends/openai'
import type { BackendParamModel } from '../backends/types'
import { CLOUD_BACKENDS } from '../backends'

// The OpenAI size helper lives with its backend descriptor; re-exported here
// for the existing import sites.
export { resolveOpenAiSize } from '../backends/openai'

export interface ResolvedBackendParams {
  model: string
  params: Record<string, unknown> | null
  ui: Record<string, unknown>
}

export function serializeBackendParams(model: string, params: Record<string, unknown> | null): string {
  return JSON.stringify({ model, params })
}

// The saved model is kept as it is, in the list or not: a column whose model
// is not a row warns so and queues its tasks with the plain request.
function savedModelId(defaultModel: ModelDef | undefined, saved: SavedImageBackendParams): string {
  return saved.model.trim() !== '' ? saved.model : (defaultModel?.id ?? '')
}

// One resolution for every cloud backend: pick the saved (or default) model,
// hand the raw saved params record to the backend's descriptor, and derive
// the canonical enqueue-shaped `params` from the SAME toEnqueueParams the live
// column serializes — so the persisted and current snapshots can never disagree
// on shape or key order (a per-backend re-spelling here once gave FLUX a
// different key order, costing a spurious settings write on every launch).
function resolveWith<P extends Record<string, unknown>, M extends ModelDef>(
  descriptor: BackendParamModel<P, M>,
  modelDef: M,
  model: string,
  savedParams: Record<string, unknown>
): ResolvedBackendParams {
  const ui = descriptor.fromSaved(savedParams, modelDef)
  return { model, params: descriptor.toEnqueueParams(ui, modelDef), ui }
}

export function resolveSavedBackendParams(
  backend: CloudBackendId,
  saved: SavedImageBackendParams | null,
  models: ModelDef[],
  defaultModel: ModelDef | undefined
): ResolvedBackendParams | null {
  if (!saved) return null

  const savedParams = saved.params
  const model = savedModelId(defaultModel, saved)
  const modelDef = models.find((m) => m.id === model)
  // A model not in the list has no parameters to resolve; the column starts
  // from the backend's own defaults once another model is chosen.
  if (!modelDef) return model ? { model, params: {}, ui: CLOUD_BACKENDS[backend].defaults() } : null

  if (backend === 'openai') {
    return resolveWith(openaiBackend, modelDef as OpenAIModelDef, model, savedParams)
  }
  if (backend === 'nanobanana') {
    return resolveWith(nanoBananaBackend, modelDef as NanoBananaModelDef, model, savedParams)
  }
  if (backend === 'grok') {
    return resolveWith(grokBackend, modelDef as GrokModelDef, model, savedParams)
  }
  return resolveWith(fluxBackend, modelDef as FluxModelDef, model, savedParams)
}
