import { ThinkingLevel, type ThinkingConfig } from '@google/genai'
import type { ReasoningEffort } from 'openai/resources/shared'

// One branch per text row of SUPPORTED_MODELS, matched on the trimmed,
// lower-cased id; the request sends the id as stored. A branch translates the
// role's thinking value, one the row lists, into the provider's parameter. An id
// with no branch gets only what the feature asks for: its JSON response format
// where it reads JSON, and no thinking parameter.

const GEMINI_THINKING_LEVELS: Record<string, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
}

const OPENAI_REASONING_EFFORTS: Record<string, ReasoningEffort> = {
  none: 'none',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
}

export function geminiTextParams(model: string, thinking?: string, schema?: object): {
  thinkingConfig?: ThinkingConfig
  responseMimeType?: string
  responseSchema?: object
} {
  const json = schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}
  switch (model.trim().toLowerCase()) {
    // Gemini 3.x takes its thinking as a level.
    case 'gemini-3.1-pro-preview':
    case 'gemini-3.8-flash':
    case 'gemini-3.5-flash-lite':
      return { ...json, ...(thinking ? { thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVELS[thinking] } } : {}) }
    default:
      return json
  }
}

export function openaiTextParams(model: string, thinking?: string, schema?: object): {
  reasoning_effort?: ReasoningEffort
  response_format?: { type: 'json_object' }
} {
  const json = schema ? { response_format: { type: 'json_object' as const } } : {}
  switch (model.trim().toLowerCase()) {
    // OpenAI takes its thinking as a reasoning effort, in the same words.
    case 'gpt-6-astra':
    case 'gpt-6.1-sol':
    case 'gpt-5.6-terra':
    case 'gpt-6-luna':
      return { ...json, ...(thinking ? { reasoning_effort: OPENAI_REASONING_EFFORTS[thinking] } : {}) }
    default:
      return json
  }
}
