import { loadConfig } from '../config'
import { decodeApiKey } from '../config/api-key'
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
    const { api_key, timeout_ms, light_model, main_model } = text_ai.gemini
    const apiKey = decodeApiKey(api_key)
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
    const { api_key, endpoint, timeout_ms, light_model, main_model } = text_ai.openai
    const apiKey = decodeApiKey(api_key)
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
