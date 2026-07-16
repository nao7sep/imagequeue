import OpenAI from 'openai'
import type { AskOptions, AskResult, ConversationMessage, TextAIProvider } from './types'
import { extractJson } from './json'

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

    // NO capability-dependent parameters — no temperature, top_p, max_tokens, or
    // reasoning knobs. This path targets ANY OpenAI-compatible endpoint (OpenAI,
    // OpenRouter, xAI, DeepSeek, llama.cpp, Ollama, LM Studio) and cannot know which
    // model accepts which of those, so it sends none.
    //
    // `response_format: json_object` is a different category: it is the JSON-mode
    // directive, part of how the schema path reliably returns parseable JSON rather
    // than hoping the prompt holds — not a capability knob. `json_object` (not the
    // stricter `json_schema`) is the broadly-supported mode across these servers, and
    // it is sent ONLY when a schema is requested (elaboration); the slug path sends no
    // schema, so no format directive. extractJson still parses loosely as a backstop.
    // Trade-off knowingly kept: a few exotic endpoints 400 on json_object — rare enough
    // that guaranteeing structured output on the common endpoints wins.
    const response = await client.chat.completions.create({
      model: this.model,
      messages: toOpenAIMessages(opts.messages),
      ...(opts.schema ? { response_format: { type: 'json_object' as const } } : {}),
    }, { signal: opts.signal })

    const text = response.choices[0]?.message?.content ?? ''
    const result: AskResult = { text }

    if (opts.schema) {
      result.parsed = extractJson(text)
    }

    return result
  }
}
