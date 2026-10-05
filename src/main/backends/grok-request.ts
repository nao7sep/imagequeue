import type { Task } from '../../shared/types'

// Pure request-shaping for the xAI image backend; grok.ts performs the call.
// One branch per xAI image row of SUPPORTED_MODELS. An id with no row gets the
// plain request: the prompt, one image, returned as base64.

export function buildXaiImageBody(task: Task): Record<string, unknown> {
  const plain = { model: task.model, prompt: task.prompt, n: 1, response_format: 'b64_json' }
  switch (task.model) {
    // 2.0 takes a quality beside its ratio and resolution.
    case 'grok-imagine-image-2.0':
      return { ...plain, ...ratioAndResolution(task), quality: task.params.quality }
    // grok-imagine-image takes no quality, only its ratio and resolution.
    case 'grok-imagine-image':
      return { ...plain, ...ratioAndResolution(task) }
    default:
      return plain
  }
}

// Every value is sent as chosen, auto included.
function ratioAndResolution(task: Task): Record<string, unknown> {
  return { aspect_ratio: task.params.aspectRatio, resolution: task.params.resolution }
}
