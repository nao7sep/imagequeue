// The four cloud image backends end to end, driven through the queue IPC the
// renderer calls, with nothing substituted but Electron's window glue. Each
// generates one image with its default model, and the text AI names it: two
// backends through Gemini text and two through OpenAI text, so both text
// providers' naming model is called. The lane proves the code paths, not image
// quality, so each image uses the smallest size and lowest quality the model
// offers, saved as the backend's defaults and resolved by the renderer's own
// code. Run only by npm run test:full, through vitest.live.config.ts.

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  getDefaultModelForBackend,
  getModelsForBackend,
  type FluxModelDef,
  type GrokModelDef,
  type ModelDef,
  type NanoBananaModelDef,
  type OpenAIModelDef,
} from '../../../../src/shared/models'
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

/** Pixels in a size choice: a preset, a Nano Banana size ("512", "1K"), or a Grok resolution ("1k"). */
function pixels(size: { width: number; height: number } | string): number {
  if (typeof size !== 'string') return size.width * size.height
  const edge = /k$/i.test(size) ? Number.parseFloat(size) * 1024 : Number.parseFloat(size)
  return edge * edge
}

function smallest<T extends { width: number; height: number } | string>(sizes: T[]): T {
  return [...sizes].sort((a, b) => pixels(a) - pixels(b))[0]!
}

/** The defaults a user saves by picking the model's smallest size and lowest quality. */
function cheapestChoices(backend: CloudBackendId, model: ModelDef): Record<string, unknown> {
  switch (backend) {
    case 'openai': {
      const { width, height } = smallest((model as OpenAIModelDef).sizes)
      return { width, height, quality: 'low' }
    }
    case 'flux': {
      const { width, height } = smallest((model as FluxModelDef).sizes)
      return { width, height }
    }
    case 'nanobanana':
      return { imageSize: smallest((model as NanoBananaModelDef).imageSizes.map((size) => size.value)) }
    case 'grok': {
      const grok = model as GrokModelDef
      return {
        resolution: smallest(grok.resolutions.map((resolution) => resolution.value)),
        ...(grok.qualities ? { quality: 'low' } : {}),
      }
    }
  }
}

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
    const defaultModel = getDefaultModelForBackend(backend)!
    const saved = (settings.image_backends as unknown as Record<string, Record<string, unknown>>)[backend]
    const choices = cheapestChoices(backend, defaultModel)
    const defaults = resolveSavedImageBackendDefaults(
      backend,
      { ...saved, default_params: choices },
      getModelsForBackend(backend),
      defaultModel,
    )
    expect(defaults?.model, 'a fresh install enqueues the default model').toBe(defaultModel.id)
    expect(defaults?.params, 'the renderer keeps the cheapest choices').toMatchObject(choices)

    const task = await app.generate({ prompt: PROMPT, backend, model: defaults!.model, params: defaults!.params })
    const { metadata } = await readOutput(app, task)
    expect(metadata.model).toBe(defaultModel.id)
    expect(metadata.params, 'the task ran with those choices').toMatchObject(choices)
    expect(metadata.slug, 'the text AI named the image, not the random fallback').toMatch(/apple/)
  })
})
