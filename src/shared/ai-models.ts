import type { TextAIBackendId } from './types'

export type TextKind = 'text-frontier' | 'text-smart' | 'text-balanced' | 'text-fast'
export interface SupportedModel {
  provider: TextAIBackendId
  id: string
  kinds: readonly TextKind[]
  defaultFor: readonly TextKind[]
}

// Image rows remain in models.ts until the imaging alignment is decided.
export const SUPPORTED_MODELS: readonly SupportedModel[] = [
  { provider: 'gemini', id: 'gemini-3.1-pro-preview', kinds: ['text-smart'], defaultFor: ['text-smart'] },
  { provider: 'gemini', id: 'gemini-3.8-flash', kinds: ['text-balanced'], defaultFor: ['text-balanced'] },
  { provider: 'gemini', id: 'gemini-3.5-flash-lite', kinds: ['text-fast'], defaultFor: ['text-fast'] },
  { provider: 'openai', id: 'gpt-6-astra', kinds: ['text-frontier'], defaultFor: [] },
  { provider: 'openai', id: 'gpt-6.1-sol', kinds: ['text-smart'], defaultFor: ['text-smart'] },
  { provider: 'openai', id: 'gpt-5.6-terra', kinds: ['text-balanced'], defaultFor: ['text-balanced'] },
  { provider: 'openai', id: 'gpt-6-luna', kinds: ['text-fast'], defaultFor: ['text-fast'] },
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
