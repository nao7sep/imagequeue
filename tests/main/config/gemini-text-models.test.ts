import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../../../src/main/config/types'
import { GEMINI_TEXT_MODELS } from '../../../src/shared/models'

const ENV_VAR = 'IMAGEQUEUE_HOME'

// The Gemini text model list is now app-owned and CLOSED (GEMINI_TEXT_MODELS): it has one
// home, in code, and is not stored in config.json. The config carries only the two tier
// selections. These tests drive the real load path (parse → merge defaults → drop legacy
// list) against a hand-edited / older config.json, and pin the two things that matter:
// a stored `models` array is dropped, and the selections pointing into the list are never
// judged — an off-list pick survives verbatim, its fate decided at the API call.
//
// loadConfig memoizes in a module-level cache, so each test resets the module registry and
// re-imports the store. None load an absent file, so none triggers the first-run write-back.
describe('Gemini text models through loadConfig (closed list)', () => {
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

  // A config written before the list was closed still carries a user-owned `models` array.
  // It has no home now, so it is dropped rather than persisted as dead data — while both
  // selections, including one the shipped list no longer offers, survive untouched.
  it('drops a legacy stored list and preserves both selections verbatim', async () => {
    const loaded = await loadFrom({
      text_ai: {
        gemini: {
          models: ['gemini-3.5-flash', 'gemini-2.5-pro', 'my-fine-tune'],
          main_model: 'gemini-2.5-pro',
          light_model: 'gemini-1.0-retired',
        },
      },
    })

    expect(loaded.text_ai.gemini).not.toHaveProperty('models')
    expect(loaded.text_ai.gemini.main_model).toBe('gemini-2.5-pro')
    expect(loaded.text_ai.gemini.light_model).toBe('gemini-1.0-retired')
  })

  // A fresh-ish config with no `models` key loads without one too — the merge does not
  // reintroduce it (createDefaultConfig no longer seeds a list), and the selections stand.
  it('never introduces a models key, and leaves the selections alone', async () => {
    const loaded = await loadFrom({
      text_ai: {
        gemini: { api_key: '', timeout_ms: 30000, main_model: 'gemini-3.5-flash', light_model: 'gemini-3.1-flash-lite' },
      },
    })

    expect(loaded.text_ai.gemini).not.toHaveProperty('models')
    expect(loaded.text_ai.gemini.main_model).toBe('gemini-3.5-flash')
    expect(loaded.text_ai.gemini.light_model).toBe('gemini-3.1-flash-lite')
  })

  // The default selections a fresh install seeds are both members of the closed list —
  // the picker can show them, and nothing lands on an off-list value out of the box.
  it('seeds default selections that are members of the shipped list', async () => {
    vi.resetModules()
    const { createDefaultConfig } = await import('../../../src/main/config/defaults')
    const { gemini } = createDefaultConfig().text_ai
    expect(GEMINI_TEXT_MODELS).toContain(gemini.main_model)
    expect(GEMINI_TEXT_MODELS).toContain(gemini.light_model)
  })
})
