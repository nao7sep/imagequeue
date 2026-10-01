import { generateGeminiContent } from '../gemini-request'
import type { AskOptions, AskResult, TextAIProvider } from './types'
import type { TextRole } from '../../shared/ai-models'
import { PROVIDER_ENDPOINTS } from '../../shared/ai-models'
import { extractJson } from './json'
import { geminiTextParams } from './request'
import { assertUsableGeminiResponse } from '../provider-response'

export class GeminiProvider implements TextAIProvider {
  constructor(private model: string, private apiKey: string,
    private endpoint = PROVIDER_ENDPOINTS.gemini, private role: TextRole = 'elaboration') {}

  async ask(opts: AskOptions): Promise<AskResult> {
    const response = await generateGeminiContent({
      model: this.model, apiKey: this.apiKey, endpoint: this.endpoint,
      contents: opts.messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      generationConfig: { ...geminiTextParams(this.model, this.role, opts.schema) },
      timeoutMs: opts.timeoutMs, signal: opts.signal,
    })
    assertUsableGeminiResponse(response, 'request')
    const text = response.text ?? ''
    return { text, ...(opts.schema ? { parsed: extractJson(text) } : {}) }
  }
}
