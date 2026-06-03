// Tolerant JSON extraction for text-AI responses. Treats the model's output
// as text that contains JSON, not as raw JSON, so common LLM artifacts
// (markdown fences, surrounding prose) don't force a retry.

export function extractJson(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined

  // 1. Direct parse — the well-behaved case.
  try { return JSON.parse(trimmed) } catch { /* fall through */ }

  // 2. Fenced parse — strip ```json ... ``` or ``` ... ``` wrappers.
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced) {
    try { return JSON.parse(fenced[1]) } catch { /* fall through */ }
  }

  // 3. Balanced-substring parse — find the first `{` or `[` and shrink the
  // tail until JSON.parse succeeds. Covers prose-wrapped responses like
  // "Sure! Here you go:\n{...}\nHope that helps." without regex tricks.
  const start = trimmed.search(/[{[]/)
  if (start >= 0) {
    for (let end = trimmed.length; end > start + 1; end--) {
      try { return JSON.parse(trimmed.slice(start, end)) } catch { /* keep shrinking */ }
    }
  }

  return undefined
}
