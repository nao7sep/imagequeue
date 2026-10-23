import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../../../src/shared/types'
import { columnParams } from './column-params'
import { freshRecordsRoot, readRows, removeRecordsRoots } from '../records-fixture'

// Each Gemini client passes `retryOptions: { attempts: 1 }`, so the SDK sends
// one request per call and the app's own retry policy decides every resend:
// Nano Banana resends only an answer proving no processing, and the text
// JSON/slug caller owns text retries.
const delay = vi.hoisted(() => vi.fn(async (_ms: number) => undefined))
vi.mock('../../../src/main/utils/abortable-delay', () => ({ abortableDelay: delay }))

vi.mock('../../../src/main/config', () => ({
  loadConfig: () => ({ image_backends: { nanobanana: { timeout_ms: 180000 } } }),
}))
vi.mock('../../../src/main/config/api-keys-store', () => ({ refreshApiKeys: async () => undefined, resolveApiKey: () => 'test-key' }))
vi.mock('../../../src/main/logger', () => ({
  log: vi.fn(), serializeError: (e: unknown) => e,
}))

const { generateNanoBanana } = await import('../../../src/main/backends/nanobanana')
const { GeminiProvider } = await import('../../../src/main/text-ai/gemini')

// retry-after-ms keeps a regressed client's resends immediate, so the count
// fails the assertion instead of waiting out the SDK's backoff.
function stubServerError(status = 503, retryAfter = '1'): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'overloaded' } }), {
    status,
    headers: { 'content-type': 'application/json', 'retry-after-ms': '1', 'retry-after': retryAfter },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(removeRecordsRoots)

const task: Task = {
  id: 't1', prompt: 'a cat', backend: 'nanobanana', model: 'gemini-3-pro-image', params: columnParams('nanobanana', 'gemini-3-pro-image'),
  status: 'generating', enqueuedAt: '2026-01-01T00:00:00.000Z', startedAt: null,
  completedAt: null, durationMs: null, imagePath: null, baseName: null, error: null, providerMessage: null,
}

describe('Gemini request attempt ownership', () => {
  it.each([408, 429, 503])('Nano Banana caps safe %i retries at three requests', async (status) => {
    const fetchMock = stubServerError(status)
    await expect(generateNanoBanana(task, new AbortController().signal)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('Nano Banana does not resend an image request after a 500', async () => {
    const fetchMock = stubServerError(500)
    await expect(generateNanoBanana(task, new AbortController().signal)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a text request is not resent after a 503', async () => {
    const fetchMock = stubServerError()
    const provider = new GeminiProvider('gemini-test', 'test-key', 'https://generativelanguage.googleapis.com')
    await expect(provider.ask({
      messages: [{ role: 'user', text: 'hi' }],
      timeoutMs: 30000,
      signal: new AbortController().signal,
    } as never)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

it('records image response metadata without serializing the large inline image into a JSON copy', async () => {
  const dir = freshRecordsRoot()
  const data = 'AQID'.repeat(256 * 1024)
  const metadata = {
    modelVersion: 'gemini-image-test', responseId: 'response-1',
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
    candidates: [{
      index: 0, finishReason: 'STOP',
      safetyRatings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'NEGLIGIBLE' }],
      content: { role: 'model', parts: [
        { text: 'A generated cat', thought: false },
        { inlineData: { mimeType: 'image/png', data }, thoughtSignature: 'thought-signature' },
      ] },
    }],
  }
  const body = JSON.stringify(metadata)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'content-type': 'application/json' } })))
  const stringify = vi.spyOn(JSON, 'stringify')
  let copiedImage = false
  try {
    const result = await generateNanoBanana(task, new AbortController().signal)
    copiedImage = stringify.mock.calls.some(([value]) => {
      const response = value as { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] } | null
      return response?.candidates?.some((candidate) => candidate.content?.parts?.some((part) => part.inlineData?.data === data)) ?? false
    })
    expect(result.buffer.equals(Buffer.from(data, 'base64'))).toBe(true)
    expect(result.mimeType).toBe('image/png')
  } finally {
    stringify.mockRestore()
  }
  expect(copiedImage).toBe(false)
  const kept = JSON.parse(readRows(dir, 'ai_calls').at(-1)!.response as string)
  expect(kept).toMatchObject({
    modelVersion: metadata.modelVersion, responseId: metadata.responseId, usageMetadata: metadata.usageMetadata,
    candidates: [{
      index: 0, finishReason: 'STOP', safetyRatings: metadata.candidates[0].safetyRatings,
      content: { role: 'model', parts: [
        { text: 'A generated cat', thought: false },
        { inlineData: { mimeType: 'image/png' }, thoughtSignature: 'thought-signature' },
      ] },
    }],
  })
  expect(kept.candidates[0].content.parts[1].inlineData).not.toHaveProperty('data')
})

it('preserves Gemini response cooldown for the app retry owner', async () => {
  const fetchMock = stubServerError(503, '120')
  delay.mockClear()
  await expect(generateNanoBanana(task, new AbortController().signal)).rejects.toMatchObject({ retryAfter: '120' })
  expect(fetchMock).toHaveBeenCalledTimes(3)
  expect(delay.mock.calls.map(([ms]) => ms)).toEqual([120000, 120000])
  const provider = new GeminiProvider('gemini-test', 'test-key', 'https://generativelanguage.googleapis.com')
  await expect(provider.ask({ messages: [{ role: 'user', text: 'hi' }], timeoutMs: 30000, record: { purpose: 'prose' } }))
    .rejects.toMatchObject({ retryAfter: '120' })
})
