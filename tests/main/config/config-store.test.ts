import { describe, expect, it } from 'vitest'
import { deepMergeDefaults, normalizeGeminiTextModels } from '../../../src/main/config/config-store'
import { DEFAULT_GEMINI_TEXT_MODELS } from '../../../src/shared/models'

describe('deepMergeDefaults', () => {
  it('fills structurally absent keys from defaults', () => {
    expect(deepMergeDefaults({ a: 1 }, { a: 0, b: 2 })).toEqual({ a: 1, b: 2 })
  })

  it('preserves explicit falsy values rather than overwriting with defaults', () => {
    const loaded = { enabled: false, count: 0, name: '', nothing: null }
    const defaults = { enabled: true, count: 5, name: 'def', nothing: 'def' }
    expect(deepMergeDefaults(loaded, defaults)).toEqual(loaded)
  })

  it('merges nested objects recursively', () => {
    const loaded = { general: { a: 1 } }
    const defaults = { general: { a: 0, b: 2 }, extra: { c: 3 } }
    expect(deepMergeDefaults(loaded, defaults)).toEqual({ general: { a: 1, b: 2 }, extra: { c: 3 } })
  })

  it('keeps loaded arrays verbatim instead of merging element-wise', () => {
    const loaded = { items: [1] }
    const defaults = { items: [9, 9, 9] }
    expect(deepMergeDefaults(loaded, defaults)).toEqual({ items: [1] })
  })

  it('preserves user keys that are absent from defaults', () => {
    expect(deepMergeDefaults({ extra: 'keep' }, { known: 1 }))
      .toEqual({ extra: 'keep', known: 1 })
  })

  it('returns defaults when the loaded value is not a plain object', () => {
    const defaults = { a: 1 }
    expect(deepMergeDefaults(undefined, defaults)).toBe(defaults)
    expect(deepMergeDefaults('not an object', defaults)).toBe('not an object')
  })
})

// text_ai.gemini.models is user-owned and user-edited, so it reaches the store
// dirty from a hand-edited config.json on load and from the renderer on save.
describe('normalizeGeminiTextModels', () => {
  it('trims entries, drops empties, and de-duplicates', () => {
    expect(
      normalizeGeminiTextModels(['  gemini-3.5-flash ', '', 'gemini-2.5-pro', '   ', 'gemini-3.5-flash'])
    ).toEqual(['gemini-3.5-flash', 'gemini-2.5-pro'])
  })

  // The list is the user's: their order and their own additions survive as-is —
  // it is cleaned, never reordered or reconciled against the built-ins.
  it("keeps the user's order and their own additions", () => {
    const models = ['my-own-id', 'gemini-3.5-flash', 'another-id']
    expect(normalizeGeminiTextModels(models)).toEqual(models)
  })

  // A de-duplicated entry keeps its FIRST position rather than being moved to
  // where the duplicate sat.
  it('keeps the first occurrence when de-duplicating', () => {
    expect(normalizeGeminiTextModels(['a', 'b', 'a'])).toEqual(['a', 'b'])
  })

  it('falls back to the built-ins when nothing usable is left', () => {
    expect(normalizeGeminiTextModels([])).toEqual(DEFAULT_GEMINI_TEXT_MODELS)
    expect(normalizeGeminiTextModels(['', '   '])).toEqual(DEFAULT_GEMINI_TEXT_MODELS)
  })

  it('falls back to the built-ins when the value is not an array', () => {
    expect(normalizeGeminiTextModels(undefined)).toEqual(DEFAULT_GEMINI_TEXT_MODELS)
    expect(normalizeGeminiTextModels(null)).toEqual(DEFAULT_GEMINI_TEXT_MODELS)
    expect(normalizeGeminiTextModels('gemini-3.5-flash')).toEqual(DEFAULT_GEMINI_TEXT_MODELS)
    expect(normalizeGeminiTextModels({ 0: 'gemini-3.5-flash' })).toEqual(DEFAULT_GEMINI_TEXT_MODELS)
  })

  it('drops non-string entries rather than stringifying them', () => {
    expect(normalizeGeminiTextModels(['gemini-3.5-flash', 42, null, { id: 'x' }])).toEqual([
      'gemini-3.5-flash',
    ])
  })

  // The result is handed to a config the caller owns and may mutate, so it must
  // never alias the shared built-in array.
  it('never returns the built-in array itself', () => {
    const fallback = normalizeGeminiTextModels([])
    expect(fallback).not.toBe(DEFAULT_GEMINI_TEXT_MODELS)
    fallback.push('mutated')
    expect(DEFAULT_GEMINI_TEXT_MODELS).not.toContain('mutated')
  })
})
