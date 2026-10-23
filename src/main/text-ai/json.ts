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

  // 3. Scan the first candidate once, respecting delimiters inside strings.
  const start = trimmed.search(/[{[]/)
  if (start < 0) return undefined
  const stack: string[] = []
  let quoted = false
  let escaped = false
  for (let index = start; index < trimmed.length; index++) {
    const character = trimmed[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') quoted = true
    else if (character === '{' || character === '[') stack.push(character)
    else if (character === '}' || character === ']') {
      if (stack.pop() !== (character === '}' ? '{' : '[')) return undefined
      if (stack.length === 0) {
        try { return JSON.parse(trimmed.slice(start, index + 1)) } catch { return undefined }
      }
    }
  }
  return undefined
}
