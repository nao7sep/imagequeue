import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../../../src/main/config/defaults'
import { deepMergeDefaults } from '../../../src/main/config/config-store'
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
