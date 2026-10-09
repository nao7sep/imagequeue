import { ApiError, GoogleGenAI } from '@google/genai'
import type { AskOptions, AskResult, TextAIProvider } from './types'
import { extractJson } from './json'
import { geminiTextParams } from './request'
import { assertUsableGeminiResponse } from '../provider-response'
import { ProviderHttpError } from '../provider-errors'
import { geminiReasonField, reasonFromBody } from '../provider-reason'
import { recordAiCall } from '../records'

export class GeminiProvider implements TextAIProvider {
  constructor(private model: string, private apiKey: string, private endpoint: string, private thinking?: string) {}

  async ask(opts: AskOptions): Promise<AskResult> {
    // The app owns retries; the SDK performs exactly one attempt.
    const ai = new GoogleGenAI({
      apiKey: this.apiKey,
      httpOptions: { baseUrl: this.endpoint, timeout: opts.timeoutMs, retryOptions: { attempts: 1 } },
    })
    const request = {
      model: this.model,
      contents: opts.messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      config: geminiTextParams(this.model, this.thinking, opts.schema),
    }
    // The record keeps the request body the app built, not the HTTP request:
    // @google/genai takes no fetch or request hook to capture what it sends.
    const response = await recordAiCall(
      { backend: 'gemini', model: this.model, ...opts.record, request: { endpoint: this.endpoint, ...request }, credentials: [this.apiKey] },
      () => ai.models.generateContent({
        ...request,
        config: { ...request.config, ...(opts.signal ? { abortSignal: opts.signal } : {}) },
      }),
    ).catch((error: unknown) => {
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
