import { GenerateContentResponse } from '@google/genai'
import { ProviderHttpError, ProviderTimeoutError } from './provider-errors'
import { openaiReasonField, reasonFromBody } from './provider-reason'
import { PROVIDER_ENDPOINTS } from '../shared/ai-models'

function wireSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(wireSchema)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, key === 'type' && typeof item === 'string' ? item.toUpperCase() : wireSchema(item)]))
  return value
}

// The SDK discards failed-response headers. This wire adapter keeps Retry-After
// and the provider's error message, without changing generation parameters.
export async function generateGeminiContent(options: {
  model: string
  apiKey: string
  endpoint?: string
  contents: unknown
  generationConfig: Record<string, unknown>
  timeoutMs: number
  signal?: AbortSignal
}): Promise<GenerateContentResponse> {
  const timeout = AbortSignal.timeout(options.timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const endpoint = (options.endpoint || PROVIDER_ENDPOINTS.gemini).replace(/\/$/, '')
  const config = { ...options.generationConfig }
  if (config.responseSchema) config.responseSchema = wireSchema(config.responseSchema)
  try {
    const response = await fetch(`${endpoint}/v1beta/models/${encodeURIComponent(options.model.replace(/^models\//, ''))}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.apiKey },
      body: JSON.stringify({ contents: options.contents, generationConfig: config }), signal,
    })
    if (!response.ok) {
      const body = await response.text()
      const said = reasonFromBody(body, openaiReasonField)
      throw new ProviderHttpError(said ?? `Gemini API error ${response.status}`, response.status, said, response.headers.get('retry-after'))
    }
    return Object.assign(new GenerateContentResponse(), await response.json())
  } catch (error) {
    if (timeout.aborted && !options.signal?.aborted) throw new ProviderTimeoutError('Gemini', options.timeoutMs)
    throw error
  }
}
