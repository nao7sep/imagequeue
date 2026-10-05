import type { Task } from '../../shared/types'

// Pure request-shaping for the xAI image backend; grok.ts performs the call.
// One branch per xAI image row of SUPPORTED_MODELS. An id with no row gets the
// plain request: the prompt, one image, returned as base64.

export function buildXaiImageBody(task: Task): Record<string, unknown> {
  const plain = { model: task.model, prompt: task.prompt, n: 1, response_format: 'b64_json' }
  switch (task.model) {
    // 2.0 takes a quality beside its ratio and resolution.
    case 'grok-imagine-image-2.0':
      return { ...plain, ...ratioAndResolution(task), quality: chosen(task, 'quality', 'auto') }
    // grok-imagine-image carries its quality in the id.
    case 'grok-imagine-image':
      return { ...plain, ...ratioAndResolution(task) }
    default:
      return plain
  }
}

// Every value is sent as chosen, auto included; a value a task does not carry
// (one queued before the field existed) is sent as the field's default.
function chosen(task: Task, key: string, fallback: string): string {
  const value = task.params[key]
  return typeof value === 'string' && value !== '' ? value : fallback
}

function ratioAndResolution(task: Task): Record<string, unknown> {
  return { aspect_ratio: chosen(task, 'aspectRatio', '1:1'), resolution: chosen(task, 'resolution', '1k') }
}
