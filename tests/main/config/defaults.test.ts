import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../../../src/main/config/defaults'
import { deepMergeDefaults } from '../../../src/main/config/config-store'
import { GEMINI_TEXT_MODELS } from '../../../src/shared/models'
import { PROMPT_FORMATS, PROMPT_LENGTHS } from '../../../src/shared/session-draft'

describe('createDefaultConfig', () => {
  it('returns a fresh object each call (no shared mutable state)', () => {
    const a = createDefaultConfig()
    const b = createDefaultConfig()
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(a.general).not.toBe(b.general)
  })

  it('is a fixed point of deepMergeDefaults (merging defaults over defaults is a no-op)', () => {
    const defaults = createDefaultConfig()
    expect(deepMergeDefaults(createDefaultConfig(), defaults)).toEqual(defaults)
  })

  // The wake lock ships opt-out, not opt-in: keeping the machine awake during
  // work is the default, and a pre-existing config without the key inherits it
  // (deepMergeDefaults fills absent keys). Pin the default so it can't silently flip.
  it('keeps the system awake during work by default', () => {
    expect(createDefaultConfig().general.keep_awake_during_work).toBe(true)
    const legacy = deepMergeDefaults({ general: { export_dir: '' } }, createDefaultConfig())
    expect(legacy.general.keep_awake_during_work).toBe(true)
  })

  // The UI font defaults to blank (meaning the built-in --font-ui stack), and a pre-existing config
  // without the key inherits that blank via deepMergeDefaults rather than breaking the load.
  it('defaults the UI font to blank and backfills it for an older config', () => {
    expect(createDefaultConfig().general.ui_font_family).toBe('')
    const legacy = deepMergeDefaults({ general: { export_dir: '' } }, createDefaultConfig())
    expect(legacy.general.ui_font_family).toBe('')
  })
})

// The Gemini text list is app-owned and closed (GEMINI_TEXT_MODELS): the config seeds only
// the two tier selections, not the list. The seed must be coherent — both picks members of
// the shipped list — or a fresh install would open Settings with its own default already
// labelled "no longer offered".
describe('default Gemini text selections', () => {
  it('does not seed a stored models list', () => {
    expect(createDefaultConfig().text_ai.gemini).not.toHaveProperty('models')
  })

  it('seeds both selections as members of the closed list', () => {
    const { light_model, main_model } = createDefaultConfig().text_ai.gemini
    expect(GEMINI_TEXT_MODELS).toContain(light_model)
    expect(GEMINI_TEXT_MODELS).toContain(main_model)
  })

  // The two tier defaults are pinned so a silent flip is caught: main is the fleet's Gemini
  // default (elaboration, whose output is generated from); light is the cheapest (throwaway
  // slug). They must differ, and main must be the more capable of the two.
  it('keeps the light and main selections distinct and pinned', () => {
    const { light_model, main_model } = createDefaultConfig().text_ai.gemini
    expect(main_model).toBe('gemini-3.5-flash')
    expect(light_model).toBe('gemini-3.1-flash-lite')
    expect(light_model).not.toBe(main_model)
  })
})

// The OpenAI-compatible backend is OPEN (any endpoint), so these are starter defaults for
// the common case, not a closed contract. The endpoint stays a blank sentinel — resolved to
// the official URL in code — and the two model seeds are pinned so a flip is caught. Both were
// verified live through the real provider before shipping.
describe('default OpenAI text config', () => {
  it('leaves the endpoint blank so it resolves to the official URL in code, not a stale literal', () => {
    expect(createDefaultConfig().text_ai.openai.endpoint).toBe('')
  })

  it('seeds working starter models rather than blank (a blank model breaks the backend on first use)', () => {
    const { main_model, light_model } = createDefaultConfig().text_ai.openai
    expect(main_model).toBe('gpt-5.6-terra')
    expect(light_model).toBe('gpt-5.6-luna')
    expect(main_model.length).toBeGreaterThan(0)
    expect(light_model.length).toBeGreaterThan(0)
  })
})

// The {{FORMAT}} directive lives in config now (not code), so its contract is
// pinned at the defaults: one usable directive per format × length.
describe('default format_directives', () => {
  const fd = createDefaultConfig().brainstorm.format_directives

  it('has a non-empty part for every format and length', () => {
    for (const format of PROMPT_FORMATS) {
      expect(fd.formats[format].trim().length).toBeGreaterThan(0)
    }
    for (const length of PROMPT_LENGTHS) {
      expect(fd.lengths[length].trim().length).toBeGreaterThan(0)
    }
  })

  it('the format parts are distinct, and so are the length parts', () => {
    const formats = PROMPT_FORMATS.map((f) => fd.formats[f])
    const lengths = PROMPT_LENGTHS.map((l) => fd.lengths[l])
    expect(new Set(formats).size).toBe(formats.length)
    expect(new Set(lengths).size).toBe(lengths.length)
  })

  it('phrases ask for comma-separated tags; sentences ask for prose', () => {
    expect(fd.formats.phrases).toMatch(/comma-separated/i)
    expect(fd.formats.sentences).toMatch(/sentence|prose/i)
  })
})
