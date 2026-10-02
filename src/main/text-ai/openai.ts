import OpenAI, { APIError } from 'openai'
import type { AskOptions, AskResult, TextAIProvider } from './types'
import { extractJson } from './json'
import { openaiTextParams } from './request'
import { assertUsableOpenAIResponse } from '../provider-response'
import { ProviderHttpError } from '../provider-errors'
import { openaiReasonField, reasonFromParsed } from '../provider-reason'
import { recordAiCall } from '../records'

export class OpenAIProvider implements TextAIProvider {
  constructor(private model: string, private apiKey: string, private endpoint: string, private thinking?: string) {}

  async ask(opts: AskOptions): Promise<AskResult> {
    const client = new OpenAI({
      apiKey: this.apiKey, baseURL: this.endpoint,
      timeout: opts.timeoutMs, maxRetries: 0,
    })
    const request = {
      model: this.model,
      messages: opts.messages.map((m) => ({ role: m.role === 'model' ? 'assistant' as const : 'user' as const, content: m.text })),
      ...openaiTextParams(this.model, this.thinking, opts.schema),
    }
    const response = await recordAiCall(
      { backend: 'openai', model: this.model, ...opts.record, request: { endpoint: this.endpoint, ...request } },
      () => client.chat.completions.create(request, { signal: opts.signal }),
    ).catch((error: unknown) => {
      if (error instanceof APIError && typeof error.status === 'number') {
        throw new ProviderHttpError(error.message, error.status,
          reasonFromParsed(error.error, openaiReasonField), error.headers?.get('retry-after') ?? null)
      }
      throw error
    })
    assertUsableOpenAIResponse(response, 'request')
    const text = response.choices[0]?.message?.content ?? ''
    return { text, ...(opts.schema ? { parsed: extractJson(text) } : {}) }
  }
}
