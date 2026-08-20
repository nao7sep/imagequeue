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
  it('writes a changed ordinary field into the target', () => {
    const target = { general: { export_dir: '/old' } }
    applyChangedFields(
      target,
      { general: { export_dir: '/old' } },
      { general: { export_dir: '/new' } }
    )
    expect(target).toEqual({ general: { export_dir: '/new' } })
  })

  it('does nothing when base and next match despite different key order', () => {
    const target = { general: { a: 1, b: 2 } }
    applyChangedFields(
      target,
      { general: { a: 1, b: 2 } },
      { general: { b: 2, a: 1 } }
    )
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

describe('prototype-walking segments are rejected at the trust boundary', () => {
  // The keys walked below the allowlisted root come from the renderer payload.
  // Without this rejection, { general: { __proto__: { polluted: true } } }
  // lands the cursor on Object.prototype and the write pollutes the MAIN
  // process — the exact class of escape the top-level allowlist exists to stop.
  it('throws on __proto__ instead of walking into Object.prototype', () => {
    const base = { general: {} }
    // Build the hostile payload with a real own '__proto__' key, the shape a
    // structuredClone over IPC can deliver.
    const hostile: Record<string, unknown> = { general: JSON.parse('{"__proto__": {"polluted": "yes"}}') }
    expect(() => applyChangedFields({ general: {} } as never, base as never, hostile as never)).toThrow(/reserved key/)
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })

  it('throws on constructor and prototype segments too', () => {
    for (const key of ['constructor', 'prototype']) {
      const hostile: Record<string, unknown> = { general: { [key]: { x: 1 } } }
      expect(() => applyChangedFields({ general: {} } as never, { general: {} } as never, hostile as never)).toThrow(/reserved key/)
    }
  })
})

