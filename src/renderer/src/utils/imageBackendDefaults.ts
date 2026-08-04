import type { CloudBackendId } from '../../../shared/types'
import type {
  FluxModelDef,
  GrokModelDef,
  ImagenModelDef,
  ModelDef,
  NanoBananaModelDef,
  OpenAIModelDef,
} from '../../../shared/models'
import { fluxBackend } from '../backends/flux'
import { grokBackend } from '../backends/grok'
import { imagenBackend } from '../backends/imagen'
import { nanoBananaBackend } from '../backends/nanobanana'
import { openaiBackend } from '../backends/openai'
import type { BackendParamModel } from '../backends/types'

// The OpenAI size helpers live with their backend descriptor; re-exported here
// for the existing import sites.
export { normalizeOpenAiDimension, resolveOpenAiSize } from '../backends/openai'

export interface SavedImageBackendDefaults {
  model: string
  params: Record<string, unknown>
  ui: Record<string, unknown>
}

export function serializeImageBackendDefaults(model: string, params: Record<string, unknown>): string {
  return JSON.stringify({ model, params })
}

function savedModelId(models: ModelDef[], defaultModel: ModelDef | undefined, backendSettings: Record<string, unknown>): string {
  return typeof backendSettings.model === 'string' && models.some((m) => m.id === backendSettings.model)
    ? backendSettings.model
    : (defaultModel?.id ?? '')
}

// One resolution for every cloud backend: pick the saved (or default) model,
// hand the raw default_params record to the backend's descriptor, and derive
// the canonical enqueue-shaped `params` from the SAME toEnqueueParams the live
// column serializes — so the persisted and current snapshots can never disagree
// on shape or key order (a per-backend re-spelling here once gave FLUX a
// different key order, costing a spurious settings write on every launch).
function resolveWith<P extends Record<string, unknown>, M extends ModelDef>(
  descriptor: BackendParamModel<P, M>,
  modelDef: M,
  model: string,
  savedDefaultParams: Record<string, unknown>
): SavedImageBackendDefaults {
  const ui = descriptor.fromSaved(savedDefaultParams, modelDef)
  return { model, params: descriptor.toEnqueueParams(ui, modelDef), ui }
}

export function resolveSavedImageBackendDefaults(
  backend: CloudBackendId,
  backendSettings: Record<string, unknown> | null,
  models: ModelDef[],
  defaultModel: ModelDef | undefined
): SavedImageBackendDefaults | null {
  if (!backendSettings) return null

  const savedDefaultParams = (backendSettings.default_params as Record<string, unknown> | undefined) ?? {}
  const model = savedModelId(models, defaultModel, backendSettings)
  const modelDef = models.find((m) => m.id === model) ?? defaultModel
  if (!modelDef) return null

  if (backend === 'openai') {
    return resolveWith(openaiBackend, modelDef as OpenAIModelDef, model, savedDefaultParams)
  }
  if (backend === 'imagen') {
    return resolveWith(imagenBackend, modelDef as ImagenModelDef, model, savedDefaultParams)
  }
  if (backend === 'nanobanana') {
    return resolveWith(nanoBananaBackend, modelDef as NanoBananaModelDef, model, savedDefaultParams)
  }
  if (backend === 'grok') {
    return resolveWith(grokBackend, modelDef as GrokModelDef, model, savedDefaultParams)
  }
  return resolveWith(fluxBackend, modelDef as FluxModelDef, model, savedDefaultParams)
}
