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
  log: vi.fn(), serializeError: (e: unknown) => e,
}))
vi.mock('../../../src/main/utils/abortable-delay', () => ({ abortableDelay: async () => undefined }))

const { generateGrok } = await import('../../../src/main/backends/grok')
const { generateFlux } = await import('../../../src/main/backends/flux')
const { generateOpenAI } = await import('../../../src/main/backends/openai')
const { assertUsableGeminiResponse } = await import('../../../src/main/provider-response')
const failurePresentation = await import('../../../src/main/failure-presentation')
const { providerMessage } = await import('../../../src/main/provider-errors')
const { createTranslator } = await import('../../../src/shared/i18n/translate')
// The task keeps a message; these read it as English shows it.
const english = createTranslator('en')
const generationFailurePresentation = (...args: Parameters<typeof failurePresentation.generationFailurePresentation>): string =>
  english.text(failurePresentation.generationFailurePresentation(...args))

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

  it('keeps the provider\'s own words, whole, on the classified error', async () => {
    const said = 'Your request was rejected by the safety system. Your request may contain content that is not allowed.'
    stubStatus(400, { error: { message: said, code: 'moderation_blocked', type: 'image_generation_user_error' } })
    const refused = await generateOpenAI(task('openai', 'gpt-image-2'), signal()).catch((e: unknown) => e)
    expect(providerMessage(refused)).toBe(said)

    stubStatus(400, { error: { message: 'Invalid size.', code: 'invalid_value', type: 'invalid_request_error' } })
    const rejected = await generateOpenAI(task('openai', 'gpt-image-2'), signal()).catch((e: unknown) => e)
    expect(providerMessage(rejected)).toBe('Invalid size.')
    expect(generationFailurePresentation('openai', rejected, false)).toContain('could not generate')

    const long = 'x'.repeat(600)
    stubStatus(400, { error: long })
    const grok = await generateGrok(task('grok', 'grok-imagine'), signal()).catch((e: unknown) => e)
    expect(providerMessage(grok)).toBe(long)

    expect(providerMessage(new Error('socket hang up'))).toBeNull()
  })

  it('keeps only the reason from a Grok error body, never its code or usage', async () => {
    stubStatus(400, {
      code: 'imagine:content-moderated',
      error: 'Generated image rejected by content moderation.',
      usage: { cost_in_usd_ticks: 600000000 },
    })
    const grok = await generateGrok(task('grok', 'grok-imagine'), signal()).catch((e: unknown) => e)
    expect(providerMessage(grok)).toBe('Generated image rejected by content moderation.')
  })

  it('keeps only the reason from a FLUX error body', async () => {
    stubStatus(422, { detail: [{ loc: ['body', 'width'], msg: 'Input should be a multiple of 16', type: 'multiple_of' }] })
    const flux = await generateFlux(task('flux', 'flux-2-pro'), signal()).catch((e: unknown) => e)
    expect(providerMessage(flux)).toBe('Input should be a multiple of 16')

    stubStatus(402, { detail: 'Insufficient credits.' })
    const credits = await generateFlux(task('flux', 'flux-2-pro'), signal()).catch((e: unknown) => e)
    expect(providerMessage(credits)).toBe('Insufficient credits.')
  })

  it('takes a body that is not JSON as the provider\'s plain answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('  Service temporarily unavailable\n', { status: 503 })))
    const grok = await generateGrok(task('grok', 'grok-imagine'), signal()).catch((e: unknown) => e)
    expect(providerMessage(grok)).toBe('  Service temporarily unavailable')
  })

  it('shows no reason for a JSON body without its message field', async () => {
    stubStatus(500, { code: 'internal', usage: { cost_in_usd_ticks: 1 } })
    const grok = await generateGrok(task('grok', 'grok-imagine'), signal()).catch((e: unknown) => e)
    expect(providerMessage(grok)).toBeNull()
  })

  describe('an error body keeps its reason as written and no other field', () => {
    const KEY = 'xai-AbCdEf0123456789GhIjKlMn'
    const reason = `Request rejected. key=${KEY} at /Users/someone/.imagequeue/api-keys.json see https://api.example.com/v1/x?token=abc`
    const extra = { code: 'internal_code', type: 'TypeError', usage: { cost_in_usd_ticks: 1 } }

    function expectAsWritten(said: string | null, written: string): void {
      expect(said).toBe(written)
      for (const field of ['TypeError', 'cost_in_usd_ticks', 'internal_code']) expect(said).not.toContain(field)
    }

    it('from Grok', async () => {
      stubStatus(400, { ...extra, error: reason })
      expectAsWritten(providerMessage(await generateGrok(task('grok', 'grok-imagine'), signal()).catch((e: unknown) => e)), reason)
    })

    it('from FLUX', async () => {
      stubStatus(400, { ...extra, detail: reason })
      expectAsWritten(providerMessage(await generateFlux(task('flux', 'flux-2-pro'), signal()).catch((e: unknown) => e)), reason)
    })

    it('from OpenAI', async () => {
      const message = `${reason} C:\\Users\\someone\\notes.txt`
      stubStatus(400, { error: { ...extra, code: 'moderation_blocked', message } })
      expectAsWritten(providerMessage(await generateOpenAI(task('openai', 'gpt-image-2'), signal()).catch((e: unknown) => e)), message)
    })
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
