import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../../../src/shared/types'

// The error's own message reaches only the log, so it keeps the provider's
// answer whole, as FLUX's does.

vi.mock('../../../src/main/config', () => ({
  loadConfig: () => ({ image_backends: { grok: { timeout_ms: 180000 } } }),
}))
vi.mock('../../../src/main/config/api-keys-store', () => ({ resolveApiKey: () => 'xai-test' }))
vi.mock('../../../src/main/logger', () => ({ log: vi.fn(), serializeError: (error: unknown) => error }))
vi.mock('../../../src/main/records', () => ({
  fetchRecorded: async (_call: unknown, url: string, init: RequestInit) => {
    const response = await fetch(url, init)
    return { response, text: await response.text() }
  },
}))

const { generateGrok } = await import('../../../src/main/backends/grok')

const task: Task = {
  id: 't1', prompt: 'p', backend: 'grok', model: 'grok-imagine-image', params: {},
  status: 'generating', enqueuedAt: '2026-01-01T00:00:00.000Z', startedAt: null,
  completedAt: null, durationMs: null, imagePath: null, baseName: null, error: null,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Grok error message', () => {
  it('keeps the whole provider answer', async () => {
    const answer = JSON.stringify({ error: `${'x'.repeat(300)} end-of-answer` })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(answer, { status: 400 })))
    const error = await generateGrok(task, new AbortController().signal).catch((err: unknown) => err)
    expect((error as Error).message).toBe(`Grok API error 400: ${answer}`)
  })
})
