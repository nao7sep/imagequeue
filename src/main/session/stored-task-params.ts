import type { BackendId } from '../../shared/types'
import { SUPPORTED_MODELS, isImageModel } from '../../shared/ai-models'

/** Checks the values request shaping consumes, without mirroring provider ranges.
 *  Which fields a model takes comes from its row in the model list; a model
 *  the list does not hold is not checked. */
export function isStoredTaskParams(backend: BackendId, model: string, params: Record<string, unknown>): boolean {
  const numbers = (...keys: string[]): boolean => keys.every((key) =>
    params[key] === undefined || (typeof params[key] === 'number' && Number.isFinite(params[key])))
  const strings = (...keys: string[]): boolean => keys.every((key) =>
    params[key] === undefined || typeof params[key] === 'string')
  if (backend === 'drawthings') {
    return ['width', 'height', 'steps', 'guidance', 'seed'].every((key) => params[key] === null || numbers(key))
      && (params.negativePrompt === null || strings('negativePrompt'))
  }
  const row = SUPPORTED_MODELS.filter(isImageModel).find((candidate) => candidate.backend === backend && candidate.id === model)
  if (!row) return true
  switch (row.backend) {
    case 'openai':
      return numbers('width', 'height', 'outputCompression') && strings('quality', 'background', 'outputFormat')
    case 'nanobanana':
      return typeof params.thinking === 'string' && strings('aspectRatio', 'imageSize')
    case 'flux':
      if (row.resolutions) return strings('aspectRatio', 'resolution')
      return numbers('width', 'height') && (params.seed === null || numbers('seed')) && strings('outputFormat')
        && (!row.stepsRange || numbers('steps', 'guidance'))
    case 'grok':
      return strings('aspectRatio', 'resolution') && (!row.qualities || strings('quality'))
  }
}
