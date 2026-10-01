import type { TextAIBackendId } from './types'

export interface TextPolicy {
  maxOutputTokens?: true
  maxCompletionTokens?: true
  thinkingConfig?: { thinkingLevel: 'medium' } | { thinkingBudget: -1 }
  reasoningEffort?: 'medium'
  structuredOutput?: true
}
export interface ModelFamily {
  adapter: 'gemini.generateContent' | 'openai.chat'
  generic: boolean
  policy: TextPolicy
}

export const MODEL_FAMILIES = {
  'gemini.3': { adapter: 'gemini.generateContent', generic: false, policy: { maxOutputTokens: true, thinkingConfig: { thinkingLevel: 'medium' }, structuredOutput: true } },
  'gemini.2.5': { adapter: 'gemini.generateContent', generic: false, policy: { maxOutputTokens: true, thinkingConfig: { thinkingBudget: -1 }, structuredOutput: true } },
  'gemini.text': { adapter: 'gemini.generateContent', generic: false, policy: { maxOutputTokens: true, structuredOutput: true } },
  'gemini.generic': { adapter: 'gemini.generateContent', generic: true, policy: { maxOutputTokens: true, structuredOutput: true } },
  'openai.chat': { adapter: 'openai.chat', generic: false, policy: { maxCompletionTokens: true, reasoningEffort: 'medium', structuredOutput: true } },
  'openai.generic': { adapter: 'openai.chat', generic: true, policy: {} },
} as const satisfies Record<string, ModelFamily>
export type FamilyId = keyof typeof MODEL_FAMILIES

export const MODEL_RULES: readonly { provider: TextAIBackendId; pattern: RegExp; family: FamilyId }[] = [
  // Text pickers exclude Gemini's image families without changing image routing.
  { provider: 'gemini', pattern: /^gemini-.*image/, family: 'gemini.generic' },
  { provider: 'gemini', pattern: /^gemini-3/, family: 'gemini.3' },
  { provider: 'gemini', pattern: /^gemini-2\.5-/, family: 'gemini.2.5' },
  { provider: 'gemini', pattern: /^gemini-/, family: 'gemini.text' },
  { provider: 'openai', pattern: /^gpt-image-/, family: 'openai.generic' },
  { provider: 'openai', pattern: /^(gpt-|o[0-9])/, family: 'openai.chat' },
]
export const MODEL_EXCEPTIONS: Partial<Record<TextAIBackendId, Record<string, Partial<TextPolicy>>>> = {}

export function resolveModel(id: string, provider: TextAIBackendId): ModelFamily & { id: FamilyId } {
  const familyId = MODEL_RULES.find((rule) => rule.provider === provider && rule.pattern.test(id))?.family
    ?? `${provider}.generic`
  const family = MODEL_FAMILIES[familyId]
  return { ...family, id: familyId, policy: { ...family.policy, ...MODEL_EXCEPTIONS[provider]?.[id] } }
}

export function isTextModel(id: string, provider: TextAIBackendId): boolean {
  const family = resolveModel(id, provider)
  return !family.generic
}
