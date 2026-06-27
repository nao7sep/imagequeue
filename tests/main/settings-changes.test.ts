import { describe, expect, it } from 'vitest'
import { applyChangedFields, valuesEqual } from '../../src/main/settings-changes'

describe('valuesEqual', () => {
  it('is insensitive to object key order', () => {
    expect(valuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(valuesEqual({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } })).toBe(true)
  })

  it('treats an explicit undefined-valued key as a difference (not silently dropped)', () => {
    expect(valuesEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false)
  })

  it('compares arrays by order and length', () => {
    expect(valuesEqual([1, 2, 3], [1, 2, 3])).toBe(true)
    expect(valuesEqual([1, 2], [2, 1])).toBe(false)
    expect(valuesEqual([1], [1, 2])).toBe(false)
  })

  it('distinguishes primitives, null, and object/non-object', () => {
    expect(valuesEqual(1, 1)).toBe(true)
    expect(valuesEqual(1, '1')).toBe(false)
    expect(valuesEqual(null, null)).toBe(true)
    expect(valuesEqual(null, {})).toBe(false)
  })
})

describe('applyChangedFields', () => {
  it('writes a changed ordinary field into the target and returns no secrets', () => {
    const target = { general: { export_dir: '/old' } }
    const secrets = applyChangedFields(
      target,
      { general: { export_dir: '/old' } },
      { general: { export_dir: '/new' } }
    )
    expect(target).toEqual({ general: { export_dir: '/new' } })
    expect(secrets).toEqual([])
  })

  it('routes an api_key change to the returned secret writes, never into the target', () => {
    const target = { text_ai: { gemini: { api_key: 'PLACEHOLDER', model: 'g' } } }
    const secrets = applyChangedFields(
      target,
      { text_ai: { gemini: { api_key: 'old', model: 'g' } } },
      { text_ai: { gemini: { api_key: 'new-key', model: 'g' } } }
    )
    expect(secrets).toEqual([{ secret: 'text_ai.gemini', value: 'new-key' }])
    // The key must never be written into config (target) — only routed out.
    expect(target.text_ai.gemini.api_key).toBe('PLACEHOLDER')
  })

  it('does nothing when base and next match despite different key order', () => {
    const target = { general: { a: 1, b: 2 } }
    const secrets = applyChangedFields(
      target,
      { general: { a: 1, b: 2 } },
      { general: { b: 2, a: 1 } }
    )
    expect(secrets).toEqual([])
    expect(target).toEqual({ general: { a: 1, b: 2 } })
  })

  it('does not falsely reject a reordered but unchanged unsupported section', () => {
    // Regression: a JSON.stringify compare saw key reordering in an unsupported
    // section (e.g. brainstorm) as a change and threw, which blocked the whole
    // settings save. The structural compare treats it as unchanged.
    expect(() =>
      applyChangedFields(
        { general: { a: 1 } },
        { general: { a: 1 }, brainstorm: { x: 1, y: 2 } },
        { general: { a: 1 }, brainstorm: { y: 2, x: 1 } }
      )
    ).not.toThrow()
  })

  it('throws when an unsupported top-level section actually changes', () => {
    expect(() => applyChangedFields({}, { bogus: 1 }, { bogus: 2 })).toThrow(/unsupported settings section/i)
  })

  it('throws when the changes are not an object at the root', () => {
    expect(() => applyChangedFields({}, {}, 42)).toThrow(/must be an object/i)
  })
})
