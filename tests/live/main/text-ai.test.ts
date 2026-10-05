// The elaboration role end to end on each text provider's default row: one
// strict-schema ask through the provider handle the brainstorm uses, with the
// shortest prompt. The slug role is proved by the image lane, which names one
// image through each provider. Run only by npm run test:full, through
// vitest.live.config.ts.

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { TextAIBackendId } from '../../../src/shared/types'
import { CACHE, requireKeys, startApp, stopApp, textKey, type App } from './live-app'

vi.mock('electron', () => import('./electron-glue'))

let home: string
let app: App

beforeAll(async () => {
  await mkdir(CACHE, { recursive: true })
  home = await mkdtemp(join(CACHE, 'text-'))
  app = await startApp(home)
})

afterAll(async () => {
  try {
    if (app) await stopApp(app)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

describe('the live text elaboration role', () => {
  it.each<TextAIBackendId>(['gemini', 'openai'])('answers in the strict prompts schema through %s', async (text) => {
    requireKeys([textKey(text)])
    await app.useTextBackend(text)
    const { getMainProvider } = await import('../../../src/main/text-ai')
    const { PROMPTS_RESPONSE_SCHEMA } = await import('../../../src/main/text-ai/templates')
    const handle = getMainProvider()!
    const result = await handle.provider.ask({
      messages: [{ role: 'user', text: 'Write one image prompt of five words about an apple.' }],
      schema: PROMPTS_RESPONSE_SCHEMA,
      timeoutMs: handle.timeoutMs,
      record: { purpose: 'live-test' },
    })
    const prompts = (result.parsed as { prompts?: unknown }).prompts
    expect(Array.isArray(prompts) && prompts.length > 0 && prompts.every((prompt) => typeof prompt === 'string')).toBe(true)
  })
})
