import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeminiProvider } from '../../../src/main/text-ai/gemini'
import { OpenAIProvider } from '../../../src/main/text-ai/openai'
import { ProviderRefusalError } from '../../../src/main/provider-errors'
import { PROVIDER_ENDPOINTS } from '../../../src/shared/ai-models'

afterEach(() => { vi.unstubAllGlobals() })
function reply(body: unknown): Response { return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }) }
const OFF_FOR_EVERY_CATEGORY = ['HARASSMENT', 'HATE_SPEECH', 'SEXUALLY_EXPLICIT', 'DANGEROUS_CONTENT', 'JAILBREAK']
  .map((name) => ({ category: `HARM_CATEGORY_${name}`, threshold: 'OFF' }))
const opts = { messages: [{ role: 'user' as const, text: 'prompt' }], timeoutMs: 1000, signal: new AbortController().signal, record: { purpose: 'test' } }

describe('text adapter outbound contracts', () => {
  it('routes known OpenAI ids by id at a custom endpoint and other ids with only the feature\'s JSON format', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => reply({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }))
    vi.stubGlobal('fetch', fetchMock)
    await new OpenAIProvider('gpt-6-luna', 'test-key', 'https://proxy.example/v1', 'medium').ask({ ...opts, schema: {} })
    const known = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect(known).toEqual({ model: 'gpt-6-luna', messages: [{ role: 'user', content: 'prompt' }], reasoning_effort: 'medium', response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: {} } } })
    await new OpenAIProvider('local-id', 'test-key', 'https://proxy.example/v1').ask({ ...opts, schema: {} })
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({ model: 'local-id', messages: [{ role: 'user', content: 'prompt' }], response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: {} } } })
  })
  it('uses the Gemini endpoint with the 3.x thinking level and sends an id with no row nothing model-specific', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => reply({ candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }] }))
    vi.stubGlobal('fetch', fetchMock)
    await new GeminiProvider('gemini-3.8-flash', 'test-key', 'https://proxy.example', 'medium').ask({ ...opts, schema: { type: 'object' } })
    expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.example/v1beta/models/gemini-3.8-flash:generateContent')
    const known = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(known.generationConfig).toEqual({ thinkingConfig: { thinkingLevel: 'MEDIUM' }, responseMimeType: 'application/json', responseJsonSchema: { type: 'object' } })
    expect(known.safetySettings).toEqual(OFF_FOR_EVERY_CATEGORY)
    await new GeminiProvider('gemini-2.5-pro', 'test-key', PROVIDER_ENDPOINTS.gemini).ask(opts)
    const unknown = JSON.parse(fetchMock.mock.calls[1][1]?.body as string)
    expect(unknown.generationConfig).toEqual({})
    expect(unknown.safetySettings, 'safety is the app\'s, sent for every id').toEqual(OFF_FOR_EVERY_CATEGORY)
  })
  it('lets a typed unknown Gemini id reach the provider and keeps its cleaned message', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ error: { code: 404, message: 'No model my-custom-id', status: 'NOT_FOUND' } }),
      { status: 404, headers: { 'content-type': 'application/json', 'retry-after': '2' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(new GeminiProvider('my-custom-id', 'test-key', PROVIDER_ENDPOINTS.gemini).ask(opts)).rejects.toMatchObject({ status: 404, providerMessage: 'No model my-custom-id', retryAfter: null })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).generationConfig).not.toHaveProperty('thinkingConfig')
  })
  it('never takes a Gemini answer that is not JSON for the provider message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway', headers: { 'content-type': 'text/html' } })))
    await expect(new GeminiProvider('gemini-3.8-flash', 'test-key', PROVIDER_ENDPOINTS.gemini).ask(opts)).rejects.toMatchObject({ status: 502, providerMessage: null })
  })
  it.each(['SAFETY', 'PROHIBITED_CONTENT'])('classifies Gemini %s as a refusal', async (finishReason) => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ candidates: [{ finishReason }] })))
    await expect(new GeminiProvider('gemini-3.8-flash', 'test-key', PROVIDER_ENDPOINTS.gemini).ask(opts)).rejects.toBeInstanceOf(ProviderRefusalError)
  })
})
