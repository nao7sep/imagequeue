import type { GenerateContentConfig } from '@google/genai'
import type { Task } from '../../shared/types'

// Pure request-shaping for the Gemini image backend; nanobanana.ts performs the
// call. One branch per Gemini image row of SUPPORTED_MODELS. An id with no row
// gets the plain request: the prompt and an image in the answer.

export interface GeminiImageRequest {
  model: string
  contents: string
  config: GenerateContentConfig
}

export function buildGeminiImageRequest(task: Task): GeminiImageRequest {
  const plain: GenerateContentConfig = { responseModalities: ['TEXT', 'IMAGE'] }
  const request = (config: GenerateContentConfig): GeminiImageRequest => ({ model: task.model, contents: task.prompt, config })
  switch (task.model) {
    // Each takes its aspect ratio and size as an image config.
    case 'gemini-3-pro-image':
    case 'gemini-3.1-flash-image':
    case 'gemini-2.5-flash-image':
    case 'gemini-3.1-flash-lite-image':
      return request({ ...plain, imageConfig: imageConfig(task) })
    default:
      return request(plain)
  }
}

function imageConfig(task: Task): { aspectRatio: string; imageSize: string } {
  return {
    aspectRatio: (task.params.aspectRatio as string) || '1:1',
    imageSize: (task.params.imageSize as string) || '1K',
  }
}
