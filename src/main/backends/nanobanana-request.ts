import type { GenerateContentConfig, ThinkingLevel } from '@google/genai'
import type { Task } from '../../shared/types'
import { findModel } from '../../shared/ai-models'
import { GEMINI_SAFETY_SETTINGS } from '../text-ai/request'

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
    // Each takes its aspect ratio and size as an image config, its thinking as a
    // level, Google's enum spelling of the row's word (each row lists the levels
    // it takes), and every current harm category off.
    case 'gemini-3-pro-image':
    case 'gemini-3.1-flash-image':
    case 'gemini-3.1-flash-lite-image':
      return request({ ...plain, safetySettings: GEMINI_SAFETY_SETTINGS, imageConfig: imageConfig(task), thinkingConfig: { thinkingLevel: thinking(task).toUpperCase() as ThinkingLevel } })
    default:
      return request(plain)
  }
}

// A value a task does not carry (one queued before the field existed) is sent
// as the field's default.
function imageConfig(task: Task): { aspectRatio: string; imageSize: string } {
  return {
    aspectRatio: (task.params.aspectRatio as string | undefined) ?? '1:1',
    imageSize: (task.params.imageSize as string | undefined) ?? '1K',
  }
}

function thinking(task: Task): string {
  const chosen = task.params.thinking
  return typeof chosen === 'string' && chosen !== '' ? chosen : findModel('nanobanana', task.model)!.defaultThinking
}
