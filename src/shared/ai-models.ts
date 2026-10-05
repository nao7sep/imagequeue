import type { TextAIBackendId } from './types'

export type TextKind = 'text-frontier' | 'text-smart' | 'text-balanced' | 'text-fast'
export interface SupportedModel {
  provider: TextAIBackendId
  id: string
  kinds: readonly TextKind[]
  defaultFor: readonly TextKind[]
  // The thinking values the model accepts, in the provider's own words: a
  // no-thinking value first, then lowest to highest.
  thinking: readonly string[]
  // The value a role sends until the user picks another, set by the model's own
  // tier, not by the role it serves.
  defaultThinking: string
}

// The lineup research document these rows and defaults rest on.
export const MODEL_LINEUP = 'ai-model-lineup-20261004'

// Image rows remain in models.ts until the imaging alignment is decided.
export const SUPPORTED_MODELS: readonly SupportedModel[] = [
  { provider: 'gemini', id: 'gemini-3.1-pro-preview', kinds: ['text-smart'], defaultFor: ['text-smart'], thinking: ['low', 'medium', 'high'], defaultThinking: 'medium' },
  { provider: 'gemini', id: 'gemini-3.8-flash', kinds: ['text-balanced'], defaultFor: ['text-balanced'], thinking: ['low', 'medium', 'high'], defaultThinking: 'medium' },
  { provider: 'gemini', id: 'gemini-3.5-flash-lite', kinds: ['text-fast'], defaultFor: ['text-fast'], thinking: ['minimal', 'low', 'medium', 'high'], defaultThinking: 'minimal' },
  { provider: 'openai', id: 'gpt-6-astra', kinds: ['text-frontier'], defaultFor: [], thinking: ['low', 'medium', 'high', 'xhigh', 'max'], defaultThinking: 'medium' },
  { provider: 'openai', id: 'gpt-6.1-sol', kinds: ['text-smart'], defaultFor: ['text-smart'], thinking: ['low', 'medium', 'high', 'xhigh', 'max'], defaultThinking: 'medium' },
  { provider: 'openai', id: 'gpt-5.6-terra', kinds: ['text-balanced'], defaultFor: ['text-balanced'], thinking: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], defaultThinking: 'medium' },
  { provider: 'openai', id: 'gpt-6-luna', kinds: ['text-fast'], defaultFor: ['text-fast'], thinking: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], defaultThinking: 'none' },
]

export const AI_ROLES = [
  // Expands and varies a prompt; long outputs need balanced text quality.
  { id: 'elaboration', kind: 'text-balanced' },
  // File names from a prompt; short outputs need fast text quality.
  { id: 'slug', kind: 'text-fast' },
] as const
export type TextRole = (typeof AI_ROLES)[number]['id']
export const TEXT_PROVIDERS = ['gemini', 'openai'] as const
export const PROVIDER_ENDPOINTS: Record<TextAIBackendId, string> = {
  gemini: 'https://generativelanguage.googleapis.com',
  openai: 'https://api.openai.com/v1',
}

export function modelsFor(provider: TextAIBackendId, kind: TextKind): SupportedModel[] {
  return SUPPORTED_MODELS.filter((row) => row.provider === provider && row.kinds.includes(kind))
}

export function defaultModelFor(provider: TextAIBackendId, kind: TextKind): string {
  const rows = modelsFor(provider, kind)
  const row = rows.find((model) => model.defaultFor.includes(kind)) ?? rows[0]
  if (!row) throw new Error(`No model for ${provider}/${kind}`)
  return row.id
}

export function textRowFor(provider: TextAIBackendId, id: string): SupportedModel | undefined {
  const key = id.trim().toLowerCase()
  return SUPPORTED_MODELS.find((row) => row.provider === provider && row.id === key)
}

// The value a role sends: its chosen value when the row lists it, else the
// row's default.
export function thinkingFor(row: SupportedModel, chosen: string): string {
  return row.thinking.includes(chosen) ? chosen : row.defaultThinking
}

// A row with one thinking value offers no choice, so it shows no Thinking field.
export function hasThinkingChoice(row: SupportedModel | undefined): row is SupportedModel {
  return row !== undefined && row.thinking.length > 1
}
