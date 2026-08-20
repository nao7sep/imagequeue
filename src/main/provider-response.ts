/**
 * Guards that read the provider's own account of a result before anything parses it —
 * ai-model-routing-conventions, *never invent a cause the provider gave you*.
 *
 * The failure these prevent is not a vague error but a confident wrong one. Measured across
 * the fleet on 2026-08-20: a refused Gemini request surfaced as "returned an empty text
 * response", and that message was believed well enough to produce a written finding that a
 * widely-used model could not transcribe audio — a defect that does not exist. A refusal is
 * the user's to act on (they must change the input) and only the stated reason says so.
 *
 * Truncation is the quieter half of the same rule: the payload is present and a result cut at
 * the token ceiling reads exactly like a complete short one, so nothing downstream can tell.
 *
 * Two providers, two vocabularies, one rule. Anything else a response carries is each caller's
 * own call — this module is the floor, not the ceiling.
 */

interface GeminiLike {
  promptFeedback?: { blockReason?: string }
  candidates?: { finishReason?: string }[]
}

export function assertUsableGeminiResponse(response: GeminiLike, what: string): void {
  const blockReason = response.promptFeedback?.blockReason
  if (blockReason) {
    throw new Error(`Gemini refused this ${what} (${blockReason}). The input was rejected, not lost.`)
  }
  const finishReason = response.candidates?.[0]?.finishReason
  if (finishReason === 'MAX_TOKENS') {
    throw new Error(`Gemini stopped at its output limit, so this ${what} is truncated rather than complete.`)
  }
  // Absent is normal — not every response carries one; only a stated non-STOP reason is a signal.
  if (finishReason && finishReason !== 'STOP') {
    throw new Error(`Gemini stopped early (${finishReason}), so this ${what} is incomplete.`)
  }
}

interface OpenAILike {
  choices?: { finish_reason?: string | null; message?: { refusal?: string | null } }[]
}

export function assertUsableOpenAIResponse(response: OpenAILike, what: string): void {
  const choice = response.choices?.[0]
  // A refusal arrives as a `refusal` string with null content — reading only `content` reports
  // our own emptiness instead of the model's stated reason.
  if (choice?.message?.refusal) {
    throw new Error(`The model declined this ${what}: ${choice.message.refusal}`)
  }
  if (choice?.finish_reason === 'content_filter') {
    throw new Error(`The provider's content filter rejected this ${what}. The input was rejected, not lost.`)
  }
  if (choice?.finish_reason === 'length') {
    throw new Error(`The model stopped at its output limit, so this ${what} is truncated rather than complete.`)
  }
}
