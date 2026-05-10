import { GoogleGenAI } from '@google/genai'
import { loadConfig } from './config'
import { decodeApiKey } from './config/api-key'
import { getElaborator } from './elaborators'
import { log, logApiRequest, logApiResponse } from './logger'

interface BrainstormResult {
  prompts: string[]
}

// Generate N elaborated prompts from a seed using the selected elaborator's template.
// Returns exactly `count` prompts on success, or throws.
export async function brainstormPrompts(
  elaboratorId: string,
  seed: string,
  count: number
): Promise<BrainstormResult> {
  if (count < 1) throw new Error('Count must be at least 1.')
  if (!seed.trim()) throw new Error('Seed prompt is empty.')

  const elaborator = getElaborator(elaboratorId)
  if (!elaborator) throw new Error('Elaborator not found.')

  const config = loadConfig()
  const { backend, main_model: model, api_key, timeout_ms } = config.text_ai
  const apiKey = decodeApiKey(api_key)
  if (!apiKey) throw new Error('Text AI API key is not configured.')
  if (backend !== 'gemini') throw new Error(`Unsupported text AI backend: ${backend}`)

  const systemPrompt = `${elaborator.template}\n\nUser's seed: ${seed}\nProduce ${count} distinct prompt${count === 1 ? '' : 's'}. One per line. No numbering, no commentary.`

  logApiRequest('text-ai', 'brainstorm', { backend, model, count, elaborator: elaborator.name })
  const startTime = Date.now()

  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeout_ms } })
  let response
  try {
    response = await ai.models.generateContent({ model, contents: systemPrompt })
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError'
    log('warn', isTimeout ? 'Brainstorm timed out' : 'Brainstorm call failed', {
      backend, model, count,
      message: err instanceof Error ? err.message : String(err),
    })
    throw err instanceof Error ? err : new Error(String(err))
  }

  logApiResponse('text-ai', 'ok', Date.now() - startTime)

  const raw = response.text ?? ''
  const prompts = parseBrainstormResponse(raw, count)
  if (prompts.length === 0) {
    log('warn', 'Brainstorm returned no usable prompts', { rawResponse: raw })
    throw new Error('Text AI returned no usable prompts.')
  }

  return { prompts }
}

// Split lines, strip leading numbering / bullets, drop empties, collapse to <= count.
function parseBrainstormResponse(raw: string, count: number): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => stripLeadingMarker(line.trim()))
    .filter((line) => line.length > 0)

  if (lines.length >= count) return lines.slice(0, count)
  return lines
}

function stripLeadingMarker(line: string): string {
  return line
    .replace(/^[-*•·]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim()
}
