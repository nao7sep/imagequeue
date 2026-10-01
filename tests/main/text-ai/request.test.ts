import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeminiProvider } from '../../../src/main/text-ai/gemini'
import { OpenAIProvider } from '../../../src/main/text-ai/openai'
import { ProviderRefusalError } from '../../../src/main/provider-errors'

afterEach(() => { vi.unstubAllGlobals() })
function reply(body: unknown): Response { return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }) }
const opts = { messages: [{ role: 'user' as const, text: 'prompt' }], timeoutMs: 1000, signal: new AbortController().signal }

describe('text adapter outbound contracts', () => {
  it('routes known OpenAI ids by id at a custom endpoint and generic ids with model/messages only', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => reply({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }))
    vi.stubGlobal('fetch', fetchMock)
    await new OpenAIProvider('gpt-6-luna', 'test-key', 'https://proxy.example/v1', 'slug').ask({ ...opts, schema: {} })
    const known = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect(known).toMatchObject({ model: 'gpt-6-luna', max_completion_tokens: 2048, reasoning_effort: 'medium', response_format: { type: 'json_object' } })
    expect(known).not.toHaveProperty('temperature')
    await new OpenAIProvider('local-id', 'test-key', 'https://proxy.example/v1', 'elaboration').ask({ ...opts, schema: {} })
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({ model: 'local-id', messages: [{ role: 'user', content: 'prompt' }] })
  })
  it('uses the Gemini endpoint with 3.x thinking levels, 2.5 budget, and the role ceiling', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => reply({ candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }] }))
    vi.stubGlobal('fetch', fetchMock)
    await new GeminiProvider('gemini-3.8-flash', 'test-key', 'https://proxy.example', 'elaboration').ask({ ...opts, schema: { type: 'object' } })
    expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.example/v1beta/models/gemini-3.8-flash:generateContent')
    const known = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(known.generationConfig).toEqual({ maxOutputTokens: 16384, thinkingConfig: { thinkingLevel: 'medium' }, responseMimeType: 'application/json', responseSchema: { type: 'OBJECT' } })
    await new GeminiProvider('gemini-2.5-pro', 'test-key', '', 'slug').ask(opts)
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string).generationConfig).toEqual({ maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: -1 } })
  })
  it('lets a typed unknown Gemini id reach the provider and retains its cleaned message and Retry-After', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ error: { message: 'No model my-custom-id' } }), { status: 404, headers: { 'retry-after': '2' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(new GeminiProvider('my-custom-id', 'test-key').ask(opts)).rejects.toMatchObject({ status: 404, providerMessage: 'No model my-custom-id', retryAfter: '2' })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).generationConfig).not.toHaveProperty('thinkingConfig')
  })
  it.each(['SAFETY', 'PROHIBITED_CONTENT'])('classifies Gemini %s as a refusal', async (finishReason) => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ candidates: [{ finishReason }] })))
    await expect(new GeminiProvider('gemini-3.8-flash', 'test-key').ask(opts)).rejects.toBeInstanceOf(ProviderRefusalError)
  })
})
