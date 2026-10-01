import { resolveModel } from '../../shared/model-registry'
import type { TextRole } from '../../shared/ai-models'

export function outputCeiling(role: TextRole): number {
  return role === 'slug' ? 2048 : 16384
}

export function geminiTextParams(model: string, role: TextRole, schema?: object): {
  maxOutputTokens?: number
  thinkingConfig?: { thinkingLevel: 'medium' } | { thinkingBudget: -1 }
  responseMimeType?: string
  responseSchema?: object
} {
  const { policy } = resolveModel(model, 'gemini')
  return {
    ...(policy.maxOutputTokens ? { maxOutputTokens: outputCeiling(role) } : {}),
    ...(policy.thinkingConfig ? { thinkingConfig: policy.thinkingConfig } : {}),
    ...(schema && policy.structuredOutput ? { responseMimeType: 'application/json', responseSchema: schema } : {}),
  }
}

export function openaiTextParams(model: string, role: TextRole, schema?: object): {
  max_completion_tokens?: number
  reasoning_effort?: 'medium'
  response_format?: { type: 'json_object' }
} {
  const { policy } = resolveModel(model, 'openai')
  return {
    ...(policy.maxCompletionTokens ? { max_completion_tokens: outputCeiling(role) } : {}),
    ...(policy.reasoningEffort ? { reasoning_effort: policy.reasoningEffort } : {}),
    ...(schema && policy.structuredOutput ? { response_format: { type: 'json_object' } } : {}),
  }
}
