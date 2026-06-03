import { GoogleGenAI } from '@google/genai'
import type { AskOptions, AskResult, ConversationMessage, TextAIProvider } from './types'
import { extractJson } from './json'

interface GeminiContent {
  role: 'user' | 'model'
  parts: { text: string }[]
}

function toGeminiContents(messages: ConversationMessage[]): GeminiContent[] {
  return messages.map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }))
}

export class GeminiProvider implements TextAIProvider {
  constructor(private model: string, private apiKey: string) {}

  async ask(opts: AskOptions): Promise<AskResult> {
    const ai = new GoogleGenAI({
      apiKey: this.apiKey,
      httpOptions: { timeout: opts.timeoutMs },
    })

    const config = opts.schema
      ? {
          responseMimeType: 'application/json',
          responseSchema: opts.schema,
        }
      : undefined

    const response = await ai.models.generateContent({
      model: this.model,
      contents: toGeminiContents(opts.messages),
      ...(config ? { config } : {}),
    })

    const text = response.text ?? ''
    const result: AskResult = { text }

    if (opts.schema) {
      result.parsed = extractJson(text)
    }

    return result
  }
}
