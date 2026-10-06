import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../../../src/shared/types'
import { columnParams } from './column-params'
import { freshRecordsRoot, readRows, removeRecordsRoots } from '../records-fixture'

// Nothing is cut (data-lifecycle-conventions): an AI call made through the
// OpenAI SDK is recorded with the HTTP request the SDK sent, its URL, method,
// headers and the key they carry included, never the image bytes.

vi.mock('../../../src/main/config', () => ({
  loadConfig: () => ({ image_backends: { openai: { timeout_ms: 180000 } } }),
}))
vi.mock('../../../src/main/config/api-keys-store', () => ({ resolveApiKey: () => 'sk-test' }))
vi.mock('../../../src/main/logger', () => ({ log: vi.fn(), serializeError: (error: unknown) => error }))

const { generateOpenAI } = await import('../../../src/main/backends/openai')
const { OpenAIProvider } = await import('../../../src/main/text-ai/openai')

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(() => {
  removeRecordsRoots()
})

const task: Task = {
  id: 't1', prompt: 'a fox', backend: 'openai', model: 'gpt-image-2', params: columnParams('openai', 'gpt-image-2'),
  status: 'generating', enqueuedAt: '2026-01-01T00:00:00.000Z', startedAt: null,
  completedAt: null, durationMs: null, imagePath: null, baseName: null, error: null, providerMessage: null,
}

function answer(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
}

function recordedRequest(dir: string): { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> } {
  return JSON.parse(readRows(dir, 'ai_calls').at(-1)!.request as string)
}

describe('SDK calls in the records', () => {
  it('keep the image request the OpenAI SDK sent, the Authorization header included', async () => {
    const dir = freshRecordsRoot()
    vi.stubGlobal('fetch', vi.fn(async () => answer({ data: [{ b64_json: 'AQ==' }] })))
    await generateOpenAI(task, new AbortController().signal)

    const request = recordedRequest(dir)
    expect(request).toMatchObject({ url: 'https://api.openai.com/v1/images/generations', method: 'POST' })
    expect(request.headers.authorization).toBe('Bearer sk-test')
    expect(request.body).toMatchObject({ prompt: 'a fox', model: 'gpt-image-2', n: 1 })
    expect(JSON.parse(readRows(dir, 'ai_calls').at(-1)!.response as string)).toEqual({ data: [{}] })
  })

  it('keep the text request the OpenAI SDK sent to the configured endpoint', async () => {
    const dir = freshRecordsRoot()
    vi.stubGlobal('fetch', vi.fn(async () => answer({ choices: [{ message: { role: 'assistant', content: 'hello' } }] })))
    const provider = new OpenAIProvider('gpt-test', 'sk-text', 'https://llm.example/v1')
    await provider.ask({ messages: [{ role: 'user', text: 'hi' }], timeoutMs: 30000, record: { purpose: 'slug' } } as never)

    const request = recordedRequest(dir)
    expect(request).toMatchObject({ url: 'https://llm.example/v1/chat/completions', method: 'POST' })
    expect(request.headers.authorization).toBe('Bearer sk-text')
    expect(request.body).toMatchObject({ model: 'gpt-test', messages: [{ role: 'user', content: 'hi' }] })
  })
})
