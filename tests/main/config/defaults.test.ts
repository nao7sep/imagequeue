import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../../../src/main/config/defaults'
import { modelsFor, PROVIDER_ENDPOINTS } from '../../../src/shared/ai-models'
import { PROMPT_FORMATS, PROMPT_LENGTHS } from '../../../src/shared/session-draft'

describe('createDefaultConfig', () => {
  it('returns a fresh object each call (no shared mutable state)', () => {
    const a = createDefaultConfig()
    const b = createDefaultConfig()
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(a.general).not.toBe(b.general)
  })

  // The wake lock ships opt-out, not opt-in: keeping the machine awake during
  // work is the default, and a pre-existing config without the key inherits it
  // (absent sets resolve to built-ins). Pin the default so it can't silently flip.
  it('keeps the system awake during work by default', () => {
    expect(createDefaultConfig().general.keep_awake_during_work).toBe(true)
  })

  it('shows the native status icon by default and backfills the preference', () => {
    expect(createDefaultConfig().general.show_status_icon).toBe(true)
  })

  it('shows the preview in the main window only, by default', () => {
    expect(createDefaultConfig().general.show_preview_window).toBe(false)
  })

  // The UI font defaults to blank (meaning the built-in --font-ui stack), and a pre-existing config
  // without the key uses the built-in blank.
  it('defaults the UI font to blank and backfills it for an older config', () => {
    expect(createDefaultConfig().general.ui_font_family).toBe('')
  })
})

describe('text defaults', () => {
  it('derives each role from the supported rows', () => {
    const config = createDefaultConfig()
    expect(config.provider).toBe('gemini')
    expect(config.gemini.elaboration).toBe('gemini-3.8-flash')
    expect(config.gemini.slug).toBe('gemini-3.5-flash-lite')
    expect(config.openai.elaboration).toBe('gpt-5.6-terra')
    expect(config.openai.slug).toBe('gpt-6-luna')
    expect(modelsFor('gemini', 'text-balanced').map((row) => row.id)).toContain(config.gemini.elaboration)
    expect(config.gemini.endpoint).toBe(PROVIDER_ENDPOINTS.gemini)
    expect(config.openai.endpoint).toBe(PROVIDER_ENDPOINTS.openai)
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
