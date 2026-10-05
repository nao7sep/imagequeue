import type { BackendId } from '../../../src/shared/types'
import { findModel, getModelsForBackend } from '../../../src/shared/ai-models'
import { resolveSavedImageBackendDefaults } from '../../../src/renderer/src/utils/imageBackendDefaults'

/** The params a queue column enqueues for a model left at its defaults, built by
 *  the column's own resolution, so a fixture task carries what the app sends. */
export function columnParams(backend: BackendId, model: string): Record<string, unknown> {
  if (backend === 'drawthings') return {}
  return resolveSavedImageBackendDefaults(backend, { model }, getModelsForBackend(backend), findModel(backend, model))!.params
}
