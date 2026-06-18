import { loadConfig } from '../config'
import { resolveApiKey } from '../config/api-keys-store'
import { GeminiProvider } from './gemini'
import { OpenAIProvider } from './openai'
import type { TextAIProvider } from './types'
import type { TextAIBackendId } from '../../shared/types'

export type { TextAIProvider, ConversationMessage, AskOptions, AskResult } from './types'
export { GeminiProvider } from './gemini'
export { OpenAIProvider } from './openai'

interface ProviderHandle {
  provider: TextAIProvider
  timeoutMs: number
  backend: TextAIBackendId
  modelId: string
}

type Tier = 'light' | 'main'

// Light tier — short throwaway tasks (slug generation).
export function getLightProvider(): ProviderHandle | null {
  return buildProviderHandle('light')
}

// Main tier — general text work (prompt elaboration).
export function getMainProvider(): ProviderHandle | null {
  return buildProviderHandle('main')
}

function buildProviderHandle(tier: Tier): ProviderHandle | null {
  const { text_ai } = loadConfig()
  const backend = text_ai.backend

  if (backend === 'gemini') {
    const { timeout_ms, light_model, main_model } = text_ai.gemini
    const apiKey = resolveApiKey('text_ai.gemini')
    if (!apiKey) return null
    const modelId = tier === 'light' ? light_model : main_model
    return {
      provider: new GeminiProvider(modelId, apiKey),
      timeoutMs: timeout_ms,
      backend,
      modelId,
    }
  }

  if (backend === 'openai') {
    const { endpoint, timeout_ms, light_model, main_model } = text_ai.openai
    const apiKey = resolveApiKey('text_ai.openai')
    if (!apiKey) return null
    const modelId = tier === 'light' ? light_model : main_model
    return {
      provider: new OpenAIProvider(modelId, apiKey, endpoint),
      timeoutMs: timeout_ms,
      backend,
      modelId,
    }
  }

  throw new Error(`Unsupported text AI backend: ${backend}`)
}
