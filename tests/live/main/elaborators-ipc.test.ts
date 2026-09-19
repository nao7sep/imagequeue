// Brainstorming end to end, driven through the elaborators IPC the renderer
// calls, with nothing substituted but Electron's window glue: the shipped
// elaborators and the concept ledger turn a seed into prompts through each text
// AI provider's main model. Run only by npm run check:full, through
// vitest.live.config.ts.

import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createEmptySessionDraft } from '../../../src/shared/session-draft'
import type { ElaboratedPromptRecord, Elaborator, TextAIBackendId } from '../../../src/shared/types'
import { CACHE, PROMPT, requireKeys, startApp, stopApp, textKey, type App } from './live-app'

vi.mock('electron', () => import('./electron-glue'))

const COUNT = 2

let home: string
let app: App

beforeAll(async () => {
  await mkdir(CACHE, { recursive: true })
  home = await mkdtemp(join(CACHE, 'brainstorm-'))
  app = await startApp(home)
})

afterAll(async () => {
  try {
    if (app) await stopApp(app)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

describe('the live brainstorm', () => {
  it.each<TextAIBackendId>(['gemini', 'openai'])('brainstorms prompts from a seed through %s text', async (text) => {
    requireKeys([textKey(text)])
    await app.useTextBackend(text)
    // The Advanced Prompting modal selects the first elaborator of each kind.
    const elaborators = await app.invoke<Elaborator[]>('elaborators:list')
    const composition = elaborators.find((entry) => entry.kind === 'composition')
    const style = elaborators.find((entry) => entry.kind === 'style')
    const draft = createEmptySessionDraft()

    const result = await app.invoke<{ prompts: ElaboratedPromptRecord[] }>('elaborators:brainstorm', {
      requestId: randomUUID(),
      compositionElaboratorId: composition!.id,
      styleElaboratorId: style!.id,
      seed: PROMPT,
      count: COUNT,
      format: draft.promptFormat,
      length: draft.promptLength,
    })
    expect(result.prompts).toHaveLength(COUNT)
    for (const record of result.prompts) {
      expect(record.text.trim().length).toBeGreaterThan(0)
      expect(record.concepts.length, 'each prompt is grounded in ledger concepts').toBeGreaterThan(0)
    }
  })
})
