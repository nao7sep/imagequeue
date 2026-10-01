import { ThinkingLevel, type ThinkingConfig } from '@google/genai'

// One branch per text row of SUPPORTED_MODELS, matched on the trimmed,
// lower-cased id; the request sends the id as stored. An id with no branch gets
// only what the feature asks for: its JSON response format where it reads JSON.

export function geminiTextParams(model: string, schema?: object): {
  thinkingConfig?: ThinkingConfig
  responseMimeType?: string
  responseSchema?: object
} {
  const json = schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}
  switch (model.trim().toLowerCase()) {
    // Gemini 3.x takes a thinking level, and the provider's default differs per
    // model, so medium is stated.
    case 'gemini-3.1-pro-preview':
    case 'gemini-3.8-flash':
    case 'gemini-3.5-flash-lite':
      return { ...json, thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM } }
    default:
      return json
  }
}

export function openaiTextParams(model: string, schema?: object): {
  reasoning_effort?: 'medium'
  response_format?: { type: 'json_object' }
} {
  const json = schema ? { response_format: { type: 'json_object' as const } } : {}
  switch (model.trim().toLowerCase()) {
    // The provider's default reasoning effort differs per model, so medium is
    // stated.
    case 'gpt-6-astra':
    case 'gpt-6.1-sol':
    case 'gpt-5.6-terra':
    case 'gpt-6-luna':
      return { ...json, reasoning_effort: 'medium' }
    default:
      return json
  }
}
