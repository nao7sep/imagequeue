import { GoogleGenAI } from '@google/genai'
import type { AskOptions, AskResult, ConversationMessage, TextAIProvider } from './types'
import { extractJson } from './json'

interface GeminiContent {
  role: 'user' | 'model'
  parts: { text: string }[]
}

// Dynamic thinking — the model decides how much to reason. Stated rather than left to the
// provider's default, which is not one behaviour: measured live across the shipped list, all
// four models think unasked, by different amounts, on both tiers (slug and elaboration).
// Silence shipped four behaviours nobody chose; this ships one.
//
// `-1` and not `0`: disabling is not portable — gemini-3.1-pro-preview rejects it outright
// ("Budget 0 is invalid. This model only works in thinking mode"), and pro is on the list.
// Dynamic is accepted by every model tried. Matches mumbler and fotoready. It does NOT reduce
// cost — it makes the thinking chosen, not accidental. (The slug tier's thinking is largely
// wasteful, but capping it was declined: a cap is untested for portability and risks
// truncating elaboration mid-JSON, to save fractions of a cent at desktop volume.)
const THINKING_CONFIG = { thinkingBudget: -1 } as const

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

    const config = {
      thinkingConfig: THINKING_CONFIG,
      ...(opts.schema
        ? { responseMimeType: 'application/json', responseSchema: opts.schema }
        : {}),
      ...(opts.signal ? { abortSignal: opts.signal } : {}),
    }

    const response = await ai.models.generateContent({
      model: this.model,
      contents: toGeminiContents(opts.messages),
      config,
    })

    const text = response.text ?? ''
    const result: AskResult = { text }

    if (opts.schema) {
      result.parsed = extractJson(text)
    }

    return result
  }
}
