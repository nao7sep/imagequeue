// The four cloud image backends end to end, driven through the queue IPC the
// renderer calls, with nothing substituted but Electron's window glue. Every
// supported row generates one image, so each request branch is proved accepted
// by its provider. The lane proves the code paths, not image quality, so each
// image uses the cheapest settings the row offers, resolved by the renderer's
// own descriptor. One image per text provider is named by the text AI, which
// proves both providers' slug role; the others are named with the random
// fallback, so they spend no text calls. Run only by npm run test:full, through
// vitest.live.config.ts.

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { getModelsForBackend } from '../../../../src/shared/ai-models'
import type { ModelDef, NanoBananaModelDef } from '../../../../src/shared/models'
import type { CloudBackendId, TextAIBackendId } from '../../../../src/shared/types'
import { CLOUD_BACKENDS } from '../../../../src/renderer/src/backends'
import { CACHE, PROMPT, readOutput, requireKeys, startApp, stopApp, textKey, type App } from '../live-app'

vi.mock('electron', () => import('../electron-glue'))

const IMAGE_KEYS: Record<CloudBackendId, string> = {
  openai: 'OPENAI_IMAGE_API_KEY',
  nanobanana: 'GEMINI_NANOBANANA_API_KEY',
  grok: 'XAI_API_KEY',
  flux: 'BFL_API_KEY',
}

// The text provider that names the first row's image of a backend.
const NAMED_BY: Partial<Record<CloudBackendId, TextAIBackendId>> = { openai: 'gemini', grok: 'openai' }

/** The choices a user makes for the cheapest image a row offers. */
function cheapestChoices(backend: CloudBackendId, row: ModelDef): Record<string, unknown> {
  switch (backend) {
    case 'openai':
      return { width: 1024, height: 1024, quality: 'low', outputFormat: 'png' }
    case 'nanobanana':
      return { aspectRatio: '1:1', imageSize: '1K', thinking: (row as NanoBananaModelDef).defaultThinking }
    case 'grok':
      return { aspectRatio: '1:1', resolution: '1k', quality: 'low' }
    case 'flux':
      return row.id === 'flux-3-image'
        ? { aspectRatio: '1:1', resolution: '768sq' }
        : { width: 1024, height: 1024, outputFormat: 'png' }
  }
}

/** The enqueued params: the descriptor's own, with FLUX.2 at 512×512, below the column's ladder. */
function enqueueParams(backend: CloudBackendId, row: ModelDef): Record<string, unknown> {
  const descriptor = CLOUD_BACKENDS[backend]
  const params = descriptor.toEnqueueParams(descriptor.fromSaved(cheapestChoices(backend, row), row), row)
  return backend === 'flux' && row.id !== 'flux-3-image' ? { ...params, width: 512, height: 512 } : params
}

const ROWS = (['openai', 'nanobanana', 'grok', 'flux'] as const).flatMap((backend) =>
  getModelsForBackend(backend).map((row, index) => ({
    backend,
    model: row.id,
    row,
    namedBy: index === 0 ? NAMED_BY[backend] : undefined,
  })),
)

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

/** Runs `body` with both text keys unset, so the image is named without a text call. */
async function withoutTextKeys<T>(body: () => Promise<T>): Promise<T> {
  const names = [textKey('gemini'), textKey('openai')]
  const saved = names.map((name) => process.env[name])
  for (const name of names) delete process.env[name]
  try {
    return await body()
  } finally {
    names.forEach((name, index) => {
      if (saved[index] !== undefined) process.env[name] = saved[index]
    })
  }
}

describe('the live cloud image backends', () => {
  it.each(ROWS)('generates an image through $backend $model', async ({ backend, model, row, namedBy }) => {
    requireKeys([IMAGE_KEYS[backend], ...(namedBy ? [textKey(namedBy)] : [])])
    if (namedBy) await app.useTextBackend(namedBy)
    const params = enqueueParams(backend, row)
    const generate = () => app.generate({ prompt: PROMPT, backend, model, params })
    const task = namedBy ? await generate() : await withoutTextKeys(generate)

    const { metadata } = await readOutput(app, task)
    expect(metadata.model).toBe(model)
    expect(metadata.params, 'the task ran with those choices').toEqual(params)
    if (namedBy) expect(metadata.slug, 'the text AI named the image, not the random fallback').toMatch(/apple/)
  })
})
