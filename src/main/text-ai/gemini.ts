import { ApiError, GoogleGenAI } from '@google/genai'
import type { AskOptions, AskResult, TextAIProvider } from './types'
import type { TextRole } from '../../shared/ai-models'
import { PROVIDER_ENDPOINTS } from '../../shared/ai-models'
import { extractJson } from './json'
import { geminiTextParams } from './request'
import { assertUsableGeminiResponse } from '../provider-response'
import { ProviderHttpError } from '../provider-errors'
import { geminiReasonField, reasonFromBody } from '../provider-reason'

export class GeminiProvider implements TextAIProvider {
  constructor(private model: string, private apiKey: string,
    private endpoint = PROVIDER_ENDPOINTS.gemini, private role: TextRole = 'elaboration') {}

  async ask(opts: AskOptions): Promise<AskResult> {
    // The app owns retries; the SDK performs exactly one attempt.
    const ai = new GoogleGenAI({
      apiKey: this.apiKey,
      httpOptions: { baseUrl: this.endpoint || PROVIDER_ENDPOINTS.gemini, timeout: opts.timeoutMs, retryOptions: { attempts: 1 } },
    })
    const response = await ai.models.generateContent({
      model: this.model,
      contents: opts.messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      config: {
        ...geminiTextParams(this.model, this.role, opts.schema),
        ...(opts.signal ? { abortSignal: opts.signal } : {}),
      },
    }).catch((error: unknown) => {
      if (error instanceof ApiError) {
        const said = reasonFromBody(error.message, geminiReasonField)
        throw new ProviderHttpError(said ?? `Gemini API error ${error.status}`, error.status, said)
      }
      throw error
    })
    assertUsableGeminiResponse(response, 'request')
    const text = response.text ?? ''
    return { text, ...(opts.schema ? { parsed: extractJson(text) } : {}) }
  }
}
