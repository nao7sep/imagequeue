// The four cloud image backends end to end, driven through the queue IPC the
// renderer calls, with nothing substituted but Electron's window glue. Each
// generates one image with the renderer's saved defaults, the default model
// among them, and the text AI names it: two backends through Gemini text and
// two through OpenAI text, so both text providers' naming model is called. Run
// only by npm run check:full, through vitest.live.config.ts.

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { getDefaultModelForBackend, getModelsForBackend } from '../../../../src/shared/models'
import type { CloudBackendId, TextAIBackendId } from '../../../../src/shared/types'
import type { AppConfig } from '../../../../src/main/config/types'
import { resolveSavedImageBackendDefaults } from '../../../../src/renderer/src/utils/imageBackendDefaults'
import { CACHE, PROMPT, readOutput, requireKeys, startApp, stopApp, textKey, type App } from '../live-app'

vi.mock('electron', () => import('../electron-glue'))

const BACKENDS: Array<{ backend: CloudBackendId; key: string; text: TextAIBackendId }> = [
  { backend: 'openai', key: 'OPENAI_IMAGE_API_KEY', text: 'gemini' },
  { backend: 'nanobanana', key: 'GEMINI_NANOBANANA_API_KEY', text: 'gemini' },
  { backend: 'grok', key: 'XAI_API_KEY', text: 'openai' },
  { backend: 'flux', key: 'BFL_API_KEY', text: 'openai' },
]

let home: string
let app: App

beforeAll(async () => {
  await mkdir(CACHE, { recursive: true })
  home = await mkdtemp(join(CACHE, 'cloud-'))
  app = await startApp(home)
})

afterAll(async () => {
  try {
    if (app) await stopApp(app)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

describe('the live cloud image backends', () => {
  it.each(BACKENDS)('generates and names an image through $backend with $text text', async ({ backend, key, text }) => {
    requireKeys([key, textKey(text)])
    await app.useTextBackend(text)
    const settings = await app.invoke<AppConfig>('settings:get')
    const defaultModel = getDefaultModelForBackend(backend)
    const defaults = resolveSavedImageBackendDefaults(
      backend,
      (settings.image_backends as unknown as Record<string, Record<string, unknown>>)[backend] ?? null,
      getModelsForBackend(backend),
      defaultModel,
    )
    expect(defaults?.model, 'a fresh install enqueues the default model').toBe(defaultModel?.id)

    const task = await app.generate({ prompt: PROMPT, backend, model: defaults!.model, params: defaults!.params })
    const { metadata } = await readOutput(app, task)
    expect(metadata.model).toBe(defaultModel?.id)
    expect(metadata.slug, 'the text AI named the image, not the random fallback').toMatch(/apple/)
  })
})
