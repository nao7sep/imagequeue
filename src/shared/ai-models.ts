import type { TextAIBackendId } from './types'

export type TextKind = 'text-frontier' | 'text-smart' | 'text-balanced' | 'text-fast'
export interface SupportedModel {
  provider: TextAIBackendId
  id: string
  kinds: readonly TextKind[]
  defaultFor: readonly TextKind[]
  // The thinking values the model accepts, in the provider's own words, ascending.
  thinking: readonly string[]
}

// Image rows remain in models.ts until the imaging alignment is decided.
export const SUPPORTED_MODELS: readonly SupportedModel[] = [
  { provider: 'gemini', id: 'gemini-3.1-pro-preview', kinds: ['text-smart'], defaultFor: ['text-smart'], thinking: ['low', 'medium', 'high'] },
  { provider: 'gemini', id: 'gemini-3.8-flash', kinds: ['text-balanced'], defaultFor: ['text-balanced'], thinking: ['low', 'medium', 'high'] },
  { provider: 'gemini', id: 'gemini-3.5-flash-lite', kinds: ['text-fast'], defaultFor: ['text-fast'], thinking: ['minimal', 'low', 'medium', 'high'] },
  { provider: 'openai', id: 'gpt-6-astra', kinds: ['text-frontier'], defaultFor: [], thinking: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { provider: 'openai', id: 'gpt-6.1-sol', kinds: ['text-smart'], defaultFor: ['text-smart'], thinking: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { provider: 'openai', id: 'gpt-5.6-terra', kinds: ['text-balanced'], defaultFor: ['text-balanced'], thinking: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
  { provider: 'openai', id: 'gpt-6-luna', kinds: ['text-fast'], defaultFor: ['text-fast'], thinking: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
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

// A fast role thinks as little as the row allows; every other role thinks
// adaptively where the row offers it, else at medium, else at its first value.
export function defaultThinkingFor(row: SupportedModel, kind: TextKind): string {
  if (kind === 'text-fast') return row.thinking.find((value) => value === 'off' || value === 'none') ?? row.thinking[0]
  return ['adaptive', 'medium'].find((value) => row.thinking.includes(value)) ?? row.thinking[0]
}

// The value a role sends: its chosen value when the row lists it, else the
// role's default for the row.
export function thinkingFor(row: SupportedModel, kind: TextKind, chosen: string): string {
  return row.thinking.includes(chosen) ? chosen : defaultThinkingFor(row, kind)
}

// A row with one thinking value offers no choice, so it shows no Thinking field.
export function hasThinkingChoice(row: SupportedModel | undefined): row is SupportedModel {
  return row !== undefined && row.thinking.length > 1
}
