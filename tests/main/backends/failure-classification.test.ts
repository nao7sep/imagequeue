import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../../../src/shared/types'

// Presentation reads a failure's type and status, never its message. These run
// the errors the backends actually throw through it, so a backend that goes back
// to a plain Error fails here instead of reading as a generic failure.

let apiKey: string | null = 'test-key'
let timeoutMs = 180000

vi.mock('../../../src/main/config', () => ({
  loadConfig: () => ({
    image_backends: {
      grok: { timeout_ms: timeoutMs },
      flux: { timeout_ms: timeoutMs },
      openai: { timeout_ms: timeoutMs },
    },
  }),
}))
vi.mock('../../../src/main/config/api-keys-store', () => ({ resolveApiKey: () => apiKey }))
vi.mock('../../../src/main/logger', () => ({
  log: vi.fn(), logApiRequest: vi.fn(), logApiResponse: vi.fn(), serializeError: (e: unknown) => e,
}))
vi.mock('../../../src/main/utils/abortable-delay', () => ({ abortableDelay: async () => undefined }))

const { generateGrok } = await import('../../../src/main/backends/grok')
const { generateFlux } = await import('../../../src/main/backends/flux')
const { generateOpenAI } = await import('../../../src/main/backends/openai')
const { assertUsableGeminiResponse } = await import('../../../src/main/provider-response')
const { generationFailurePresentation } = await import('../../../src/main/failure-presentation')

function task(backend: Task['backend'], model: string): Task {
  return {
    id: 't1', prompt: 'p', backend, model, params: {},
    status: 'generating', enqueuedAt: '2026-01-01T00:00:00.000Z', startedAt: null,
    completedAt: null, durationMs: null, imagePath: null, baseName: null, error: null,
  }
}

function stubStatus(status: number, body: unknown = { error: 'nope' }): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })))
}

/** A fetch that never answers until its signal aborts, as a hung request does. */
function stubHang(): void {
  vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    })
  })))
}

const signal = (): AbortSignal => new AbortController().signal

afterEach(() => {
  vi.unstubAllGlobals()
  apiKey = 'test-key'
  timeoutMs = 180000
})

describe('backend failures reach the task row by kind', () => {
  it('names a rejected Grok or FLUX key', async () => {
    stubStatus(401)
    const grok = await generateGrok(task('grok', 'grok-imagine'), signal()).catch((e: unknown) => e)
    expect(generationFailurePresentation('grok', grok, false)).toContain('API key')

    stubStatus(403)
    const flux = await generateFlux(task('flux', 'flux-2-pro'), signal()).catch((e: unknown) => e)
    expect(generationFailurePresentation('flux', flux, false)).toContain('API key')
  })

  it('names rate limiting', async () => {
    stubStatus(429)
    const grok = await generateGrok(task('grok', 'grok-imagine'), signal()).catch((e: unknown) => e)
    expect(generationFailurePresentation('grok', grok, false)).toContain('rate-limiting')
  })

  it('names a timeout as one, for fetch and SDK backends alike', async () => {
    timeoutMs = 5
    stubHang()
    const grok = await generateGrok(task('grok', 'grok-imagine'), signal()).catch((e: unknown) => e)
    expect(generationFailurePresentation('grok', grok, false)).toContain('did not respond in time')

    stubHang()
    const flux = await generateFlux(task('flux', 'flux-2-pro'), signal()).catch((e: unknown) => e)
    expect(generationFailurePresentation('flux', flux, false)).toContain('did not respond in time')

    stubHang()
    const openai = await generateOpenAI(task('openai', 'gpt-image-2'), signal()).catch((e: unknown) => e)
    expect(generationFailurePresentation('openai', openai, false)).toContain('did not respond in time')
  })

  it('names a missing key', async () => {
    apiKey = null
    const grok = await generateGrok(task('grok', 'grok-imagine'), signal()).catch((e: unknown) => e)
    expect(generationFailurePresentation('grok', grok, false)).toContain('No Grok API key is set')
  })

  it('tells the user to change a refused prompt rather than retry it', async () => {
    stubStatus(400, { error: { message: 'blocked', code: 'moderation_blocked', type: 'image_generation_user_error' } })
    const openai = await generateOpenAI(task('openai', 'gpt-image-2'), signal()).catch((e: unknown) => e)
    const shownOpenAI = generationFailurePresentation('openai', openai, false)
    expect(shownOpenAI).toContain('refused this prompt')
    expect(shownOpenAI).toContain('moderation_blocked')

    let gemini: unknown
    try {
      assertUsableGeminiResponse({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }, 'image')
    } catch (err) {
      gemini = err
    }
    const shownGemini = generationFailurePresentation('nanobanana', gemini, false)
    expect(shownGemini).toContain('refused this prompt')
    expect(shownGemini).toContain('PROHIBITED_CONTENT')
  })

  it('names a Gemini finish reason as the provider status', () => {
    let error: unknown
    try {
      assertUsableGeminiResponse({ candidates: [{ finishReason: 'IMAGE_SAFETY' }] }, 'image')
    } catch (err) {
      error = err
    }
    expect(generationFailurePresentation('nanobanana', error, false)).toContain('IMAGE_SAFETY')
  })
})
