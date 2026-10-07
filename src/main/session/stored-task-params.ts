import type { BackendId } from '../../shared/types'

/** Checks the values request shaping consumes, without mirroring provider ranges. */
export function isStoredTaskParams(backend: BackendId, model: string, params: Record<string, unknown>): boolean {
  const numbers = (...keys: string[]): boolean => keys.every((key) =>
    params[key] === undefined || (typeof params[key] === 'number' && Number.isFinite(params[key])))
  const strings = (...keys: string[]): boolean => keys.every((key) =>
    params[key] === undefined || typeof params[key] === 'string')
  switch (backend) {
    case 'drawthings':
      return ['width', 'height', 'steps', 'guidance', 'seed'].every((key) => params[key] === null || numbers(key))
        && (params.negativePrompt === null || strings('negativePrompt'))
    case 'openai':
      if (model === 'gpt-image-2.5-flare' || model === 'gpt-image-2') {
        return numbers('width', 'height', 'outputCompression') && strings('quality', 'background', 'outputFormat')
      }
      return true
    case 'nanobanana':
      if (['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image'].includes(model)) {
        return typeof params.thinking === 'string' && strings('aspectRatio', 'imageSize')
      }
      return true
    case 'flux':
      if (model === 'flux-3-image') return strings('aspectRatio', 'resolution')
      if (['flux-2-max', 'flux-2-pro', 'flux-2-klein-9b', 'flux-2-klein-4b', 'flux-2-flex'].includes(model)) {
        return numbers('width', 'height') && (params.seed === null || numbers('seed')) && strings('outputFormat')
          && (model !== 'flux-2-flex' || numbers('steps', 'guidance'))
      }
      return true
    case 'grok':
      if (model === 'grok-imagine-image' || model === 'grok-imagine-image-2.0') {
        return strings('aspectRatio', 'resolution') && (model !== 'grok-imagine-image-2.0' || strings('quality'))
      }
      return true
  }
}
