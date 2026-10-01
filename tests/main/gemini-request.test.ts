import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateGeminiContent } from '../../src/main/gemini-request'

afterEach(() => { vi.unstubAllGlobals() })
describe('Gemini generation wire boundary', () => {
  it('retains Retry-After on a non-OK response without resending it', async () => {
    const fetch = vi.fn(async () => new Response('{"error":{"message":"busy"}}', { status: 503, headers: { 'retry-after': '5' } }))
    vi.stubGlobal('fetch', fetch)
    await expect(generateGeminiContent({ model: 'gemini-3.8-flash', apiKey: 'fixture', contents: [], generationConfig: {}, timeoutMs: 1000 })).rejects.toMatchObject({
      status: 503, providerMessage: 'busy', retryAfter: '5',
    })
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('preserves image generation parameters and reconstructs the SDK response shape', async () => {
    const fetch = vi.fn(async (_url: string, _options: RequestInit) => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'YWJj' } }] }, finishReason: 'STOP' }],
    })))
    vi.stubGlobal('fetch', fetch)
    const response = await generateGeminiContent({ model: 'gemini-3.1-flash-image', apiKey: 'fixture', contents: [{ role: 'user', parts: [{ text: 'p' }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '3:2', imageSize: '2K' } }, timeoutMs: 1000 })
    expect(JSON.parse(fetch.mock.calls[0][1].body as string).generationConfig).toEqual({ responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '3:2', imageSize: '2K' } })
    expect(response.candidates?.[0].content?.parts?.[0].inlineData?.data).toBe('YWJj')
  })
})
