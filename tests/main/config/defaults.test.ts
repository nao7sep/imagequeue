import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../../../src/main/config/defaults'
import { deepMergeDefaults } from '../../../src/main/config/config-store'
import { DEFAULT_GEMINI_TEXT_MODELS } from '../../../src/shared/models'
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

// The Gemini text model list is user-owned (config-seeding conventions): seeded
// here at first run, then freely edited. The seed and the two selections into it
// are one unit, so the seed must be coherent as shipped.
describe('default Gemini text models', () => {
  it('seeds a non-empty list from the built-in ids', () => {
    const { models } = createDefaultConfig().text_ai.gemini
    expect(models.length).toBeGreaterThan(0)
    expect(models).toEqual(DEFAULT_GEMINI_TEXT_MODELS)
  })

  // Both selections must be members of the list they point into, or a fresh
  // install would open Settings with its own defaults already showing as
  // "(not in list)".
  it('seeds both selections as members of the seeded list', () => {
    const { models, light_model, main_model } = createDefaultConfig().text_ai.gemini
    expect(models).toContain(light_model)
    expect(models).toContain(main_model)
  })

  // The two use-case defaults are pinned: a reset restores exactly these, so a
  // silent flip here would silently redefine what "Reset Gemini models" means.
  it('keeps the light and main selections distinct and pinned', () => {
    const { light_model, main_model } = createDefaultConfig().text_ai.gemini
    expect(light_model).toBe('gemini-3.1-flash-lite')
    expect(main_model).toBe('gemini-3-flash-preview')
    expect(light_model).not.toBe(main_model)
  })

  // Every caller gets a config it may mutate, so the seed copies the built-in
  // array rather than handing out the shared module-level one.
  it('copies the built-in ids instead of sharing the array across calls', () => {
    const a = createDefaultConfig()
    const b = createDefaultConfig()
    expect(a.text_ai.gemini.models).not.toBe(b.text_ai.gemini.models)
    expect(a.text_ai.gemini.models).not.toBe(DEFAULT_GEMINI_TEXT_MODELS)

    a.text_ai.gemini.models.push('user-added-id')
    expect(createDefaultConfig().text_ai.gemini.models).toEqual(DEFAULT_GEMINI_TEXT_MODELS)
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
