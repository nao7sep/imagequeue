import OpenAI from 'openai'
import type { AskOptions, AskResult, ConversationMessage, TextAIProvider } from './types'

const OFFICIAL_OPENAI_ENDPOINT = 'https://api.openai.com/v1'

function toOpenAIMessages(
  messages: ConversationMessage[]
): { role: 'user' | 'assistant'; content: string }[] {
  return messages.map((m) => ({
    role: m.role === 'model' ? 'assistant' : 'user',
    content: m.text,
  }))
}

export class OpenAIProvider implements TextAIProvider {
  constructor(private model: string, private apiKey: string, private endpoint: string) {}

  async ask(opts: AskOptions): Promise<AskResult> {
    const client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.endpoint || OFFICIAL_OPENAI_ENDPOINT,
      timeout: opts.timeoutMs,
    })

    // json_object is the broadly-compatible JSON mode across OpenAI-compatible
    // servers (OpenAI, OpenRouter, xAI, DeepSeek, llama.cpp). Strict json_schema
    // works only on some endpoints; the brainstorm caller already retries on
    // shape mismatch, so server-side schema enforcement isn't worth the
    // compatibility cost.
    const response = await client.chat.completions.create({
      model: this.model,
      messages: toOpenAIMessages(opts.messages),
      ...(opts.schema ? { response_format: { type: 'json_object' as const } } : {}),
    })

    const text = response.choices[0]?.message?.content ?? ''
    const result: AskResult = { text }

    if (opts.schema) {
      try {
        result.parsed = JSON.parse(text)
      } catch {
        result.parsed = undefined
      }
    }

    return result
  }
}
