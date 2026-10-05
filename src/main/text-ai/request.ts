import { HarmBlockThreshold, HarmCategory, ThinkingLevel, type SafetySetting, type ThinkingConfig } from '@google/genai'
import type { ReasoningEffort, ResponseFormatJSONSchema } from 'openai/resources/shared'

// One branch per text row of SUPPORTED_MODELS, matched on the trimmed,
// lower-cased id; the request sends the id as stored. A branch translates the
// role's thinking value, one the row lists, into the provider's parameter. An id
// with no branch gets only what the feature asks for: its strict JSON schema
// where it reads JSON, the app's safety settings, and no thinking parameter.

// Every Gemini request, text and image, turns each current harm category off;
// the deprecated civic-integrity category is left out.
export const GEMINI_SAFETY_SETTINGS: SafetySetting[] = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
  HarmCategory.HARM_CATEGORY_JAILBREAK,
].map((category) => ({ category, threshold: HarmBlockThreshold.OFF }))

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
  safetySettings: SafetySetting[]
  thinkingConfig?: ThinkingConfig
  responseMimeType?: string
  responseJsonSchema?: object
} {
  // responseJsonSchema takes the schema as JSON Schema, additionalProperties included.
  const plain = { safetySettings: GEMINI_SAFETY_SETTINGS, ...(schema ? { responseMimeType: 'application/json', responseJsonSchema: schema } : {}) }
  switch (model.trim().toLowerCase()) {
    // Gemini 3.x takes its thinking as a level.
    case 'gemini-3.1-pro-preview':
    case 'gemini-3.8-flash':
    case 'gemini-3.5-flash-lite':
      return { ...plain, ...(thinking ? { thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVELS[thinking] } } : {}) }
    default:
      return plain
  }
}

export function openaiTextParams(model: string, thinking?: string, schema?: object): {
  reasoning_effort?: ReasoningEffort
  response_format?: ResponseFormatJSONSchema
} {
  const json = schema
    ? { response_format: { type: 'json_schema' as const, json_schema: { name: 'answer', strict: true, schema: schema as Record<string, unknown> } } }
    : {}
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
