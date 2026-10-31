import type { BackendId } from '../../../src/shared/types'
import { findModel, getModelsForBackend } from '../../../src/shared/ai-models'
import { resolveSavedBackendParams } from '../../../src/renderer/src/utils/backendParams'

/** The params a queue column enqueues for a model left at its defaults, built by
 *  the column's own resolution, so a fixture task carries what the app sends. */
export function columnParams(backend: BackendId, model: string): Record<string, unknown> {
  if (backend === 'drawthings') return {}
  return resolveSavedBackendParams(backend, { model, params: {} }, getModelsForBackend(backend), findModel(backend, model))!.params!
}
