import { loadConfig } from '../config'
import { resolveApiKey } from '../config/api-keys-store'
import { GeminiProvider } from './gemini'
import { OpenAIProvider } from './openai'
import type { TextAIProvider } from './types'
import type { TextAIBackendId } from '../../shared/types'
import { AI_ROLES, textRowFor, thinkingFor, type TextRole } from '../../shared/ai-models'

export type { TextAIProvider, ConversationMessage, AskOptions, AskResult } from './types'
export { GeminiProvider } from './gemini'
export { OpenAIProvider } from './openai'

interface ProviderHandle {
  provider: TextAIProvider
  timeoutMs: number
  backend: TextAIBackendId
  modelId: string
}

export function getLightProvider(): ProviderHandle | null { return buildProviderHandle('slug') }
export function getMainProvider(): ProviderHandle | null { return buildProviderHandle('elaboration') }

export function buildProviderHandle(role: TextRole): ProviderHandle | null {
  const config = loadConfig()
  const backend = config.provider
  const apiKey = resolveApiKey(`${backend}.text`)
  if (!apiKey) return null
  const { endpoint, timeout_ms, [role]: modelId, thinking: chosen } = config[backend]
  const row = textRowFor(backend, modelId)
  const thinking = row ? thinkingFor(row, AI_ROLES.find((each) => each.id === role)!.kind, chosen[role]) : undefined
  return {
    provider: backend === 'gemini'
      ? new GeminiProvider(modelId, apiKey, endpoint, thinking)
      : new OpenAIProvider(modelId, apiKey, endpoint, thinking),
    timeoutMs: timeout_ms,
    backend,
    modelId,
  }
}
