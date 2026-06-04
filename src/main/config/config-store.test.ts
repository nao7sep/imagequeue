import { describe, expect, it } from 'vitest'
import { deepMergeDefaults } from './config-store'

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
