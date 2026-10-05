import type { Task } from '../../shared/types'

// Pure request-shaping for the xAI image backend; grok.ts performs the call.
// One branch per xAI image row of SUPPORTED_MODELS. An id with no row gets the
// plain request: the prompt, one image, returned as base64.

export function buildXaiImageBody(task: Task): Record<string, unknown> {
  const plain = { model: task.model, prompt: task.prompt, n: 1, response_format: 'b64_json' }
  const params = task.params as { aspectRatio?: string; resolution?: string; quality?: string }
  switch (task.model) {
    // 2.0 takes a quality beside its ratio and resolution.
    case 'grok-imagine-image-2.0':
      return { ...plain, ...ratioAndResolution(params), ...(params.quality ? { quality: params.quality } : {}) }
    // The 1.x ids carry their quality in the id.
    case 'grok-imagine-image-quality':
    case 'grok-imagine-image':
      return { ...plain, ...ratioAndResolution(params) }
    default:
      return plain
  }
}

function ratioAndResolution(params: { aspectRatio?: string; resolution?: string }): Record<string, unknown> {
  return {
    ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
    ...(params.resolution ? { resolution: params.resolution } : {}),
  }
}
