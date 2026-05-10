import { loadConfig } from '../config'
import { decodeApiKey } from '../config/api-key'
import { GeminiProvider } from './gemini'
import type { TextAIProvider } from './types'

export type { TextAIProvider, ConversationMessage, AskOptions, AskResult } from './types'
export { GeminiProvider } from './gemini'

interface ProviderHandle {
  provider: TextAIProvider
  timeoutMs: number
}

// Light tier — short throwaway tasks (slug generation).
export function getLightProvider(): ProviderHandle | null {
  const config = loadConfig()
  const { backend, light_model, api_key, timeout_ms } = config.text_ai
  const apiKey = decodeApiKey(api_key)
  if (!apiKey) return null
  return {
    provider: createProvider(backend, light_model, apiKey),
    timeoutMs: timeout_ms,
  }
}

// Main tier — general text work (prompt elaboration).
export function getMainProvider(): ProviderHandle | null {
  const config = loadConfig()
  const { backend, main_model, api_key, timeout_ms } = config.text_ai
  const apiKey = decodeApiKey(api_key)
  if (!apiKey) return null
  return {
    provider: createProvider(backend, main_model, apiKey),
    timeoutMs: timeout_ms,
  }
}

function createProvider(backend: string, model: string, apiKey: string): TextAIProvider {
  switch (backend) {
    case 'gemini':
      return new GeminiProvider(model, apiKey)
    default:
      throw new Error(`Unsupported text AI backend: ${backend}`)
  }
}
