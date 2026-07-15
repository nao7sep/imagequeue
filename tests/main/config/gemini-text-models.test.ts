import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../../../src/main/config/types'
import { DEFAULT_GEMINI_TEXT_MODELS } from '../../../src/shared/models'

const ENV_VAR = 'IMAGEQUEUE_HOME'

// The Gemini text model list is user-owned: seeded at first run, then edited in
// Settings — or by hand in config.json, which is exactly what a user reaches for
// when a model id retires. These tests drive the real load path (parse → merge
// defaults → normalize) against such a file, and pin the split the store rests
// on: it cleans the LIST, and never judges the SELECTIONS pointing into it.
//
// loadConfig memoizes its result in a module-level cache, so each test resets the
// module registry and re-imports the store to load its own config.json. None of
// these load an absent file, so none triggers the first-run write-back.
describe('Gemini text models through loadConfig', () => {
  let tmpRoot: string
  const originalHome = process.env[ENV_VAR]

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-gemini-models-'))
    process.env[ENV_VAR] = tmpRoot
  })

  afterEach(() => {
    if (originalHome === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = originalHome
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  async function loadFrom(config: unknown): Promise<AppConfig> {
    fs.writeFileSync(path.join(tmpRoot, 'config.json'), JSON.stringify(config))
    vi.resetModules()
    const { loadConfig } = await import('../../../src/main/config/config-store')
    return loadConfig()
  }

  // The store's whole job on this key: clean the list, leave the pointer alone.
  // `light_model` here names an id the user has removed from their list, and it
  // survives untouched so the UI can surface it as an out-of-list fallback —
  // snapping it to another model would silently redefine the user's choice.
  // Whether that id still works is the API call's verdict, not the store's.
  it('cleans a hand-edited list but preserves a selection that is not in it', async () => {
    const loaded = await loadFrom({
      text_ai: {
        gemini: {
          models: ['  gemini-3.5-flash ', '', 'gemini-2.5-pro', 'gemini-3.5-flash', '   '],
          light_model: 'gemini-1.0-retired',
          main_model: 'gemini-2.5-pro',
        },
      },
    })

    expect(loaded.text_ai.gemini.models).toEqual(['gemini-3.5-flash', 'gemini-2.5-pro'])
    expect(loaded.text_ai.gemini.light_model).toBe('gemini-1.0-retired')
    expect(loaded.text_ai.gemini.models).not.toContain(loaded.text_ai.gemini.light_model)
    expect(loaded.text_ai.gemini.main_model).toBe('gemini-2.5-pro')
  })

  // A config written before the list existed has no `models` key at all. It is
  // filled from the built-ins (deepMergeDefaults' absent-key rule) rather than
  // failing the load, and the selections the user already had are untouched.
  it('seeds the built-in list for a config written before the list existed', async () => {
    const loaded = await loadFrom({
      text_ai: {
        gemini: { api_key: '', timeout_ms: 30000, light_model: 'gemini-3.5-flash', main_model: 'gemini-3.5-flash' },
      },
    })

    expect(loaded.text_ai.gemini.models).toEqual(DEFAULT_GEMINI_TEXT_MODELS)
    expect(loaded.text_ai.gemini.light_model).toBe('gemini-3.5-flash')
    expect(loaded.text_ai.gemini.main_model).toBe('gemini-3.5-flash')
  })

  // An emptied list would leave the editor and both selects with nothing to
  // show, so the built-ins come back — the one case where the store overrules
  // what the file says.
  it('falls back to the built-in list when the user has emptied it', async () => {
    const loaded = await loadFrom({ text_ai: { gemini: { models: [] } } })
    expect(loaded.text_ai.gemini.models).toEqual(DEFAULT_GEMINI_TEXT_MODELS)
  })

  // The user's list is theirs: ids the app has never shipped are as durable as
  // the built-in ones, which is the point of owning the list.
  it("keeps the user's own additions and their order", async () => {
    const models = ['my-fine-tune', 'gemini-3.5-flash', 'gemini-9-not-yet-released']
    const loaded = await loadFrom({ text_ai: { gemini: { models, light_model: 'my-fine-tune' } } })

    expect(loaded.text_ai.gemini.models).toEqual(models)
    expect(loaded.text_ai.gemini.light_model).toBe('my-fine-tune')
  })
})
