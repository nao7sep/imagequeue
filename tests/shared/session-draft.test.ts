import { describe, expect, it } from 'vitest'
import {
  createEmptySessionDraft,
  MAX_DRAFT_ITERATIONS,
  normalizeSessionDraft,
  type SessionDraft,
} from '../../src/shared/session-draft'
import { BACKEND_IDS_IN_UI_ORDER } from '../../src/shared/types'

function fullDraft(): SessionDraft {
  return {
    prompt: 'a cat',
    seed: 'a cat in a hat',
    elaborated: 'a photorealistic cat wearing a striped hat',
    selectedContentElaboratorId: 'content-1',
    selectedCompositionElaboratorId: 'comp-1',
    selectedStyleElaboratorId: 'style-1',
    selectedProprietary: { openai: true, imagen: false, nanobanana: true, grok: false, flux: false, drawthings: false },
    selectedDtFiles: ['model-a.ckpt', 'model-b.ckpt'],
    promptMode: 'fresh-task',
    targetScope: 'all',
    count: 12,
  }
}

describe('createEmptySessionDraft', () => {
  it('starts blank with every backend unselected and one iteration', () => {
    const draft = createEmptySessionDraft()
    expect(draft.prompt).toBe('')
    expect(draft.seed).toBe('')
    expect(draft.elaborated).toBe('')
    expect(draft.selectedContentElaboratorId).toBeNull()
    expect(draft.selectedCompositionElaboratorId).toBeNull()
    expect(draft.selectedStyleElaboratorId).toBeNull()
    expect(draft.selectedDtFiles).toEqual([])
    expect(draft.promptMode).toBe('as-is')
    expect(draft.targetScope).toBe('selected')
    expect(draft.count).toBe(1)
    for (const backend of BACKEND_IDS_IN_UI_ORDER) {
      expect(draft.selectedProprietary[backend]).toBe(false)
    }
  })

  it('returns a fresh object each call (no shared nested references)', () => {
    const a = createEmptySessionDraft()
    const b = createEmptySessionDraft()
    a.selectedProprietary.openai = true
    a.selectedDtFiles.push('x')
    expect(b.selectedProprietary.openai).toBe(false)
    expect(b.selectedDtFiles).toEqual([])
  })
})

describe('normalizeSessionDraft', () => {
  it('passes a well-formed draft through unchanged', () => {
    expect(normalizeSessionDraft(fullDraft())).toEqual(fullDraft())
  })

  it('falls back to an empty draft for non-object input', () => {
    const empty = createEmptySessionDraft()
    expect(normalizeSessionDraft(undefined)).toEqual(empty)
    expect(normalizeSessionDraft(null)).toEqual(empty)
    expect(normalizeSessionDraft('garbage')).toEqual(empty)
    expect(normalizeSessionDraft(42)).toEqual(empty)
    expect(normalizeSessionDraft(['a', 'b'])).toEqual(empty)
  })

  it('fills only the missing fields of a partial draft', () => {
    const result = normalizeSessionDraft({ prompt: 'hello', count: 3 })
    expect(result.prompt).toBe('hello')
    expect(result.count).toBe(3)
    // Untouched fields take empty-draft defaults.
    expect(result.seed).toBe('')
    expect(result.promptMode).toBe('as-is')
    expect(result.targetScope).toBe('selected')
    expect(result.selectedDtFiles).toEqual([])
  })

  it('coerces wrong-typed string fields to defaults', () => {
    const result = normalizeSessionDraft({ prompt: 123, seed: null, elaborated: {} })
    expect(result.prompt).toBe('')
    expect(result.seed).toBe('')
    expect(result.elaborated).toBe('')
  })

  it('treats non-string elaborator ids as null', () => {
    const result = normalizeSessionDraft({
      selectedContentElaboratorId: 42,
      selectedCompositionElaboratorId: 'keep-me',
      selectedStyleElaboratorId: { id: 'x' },
    })
    expect(result.selectedContentElaboratorId).toBeNull()
    expect(result.selectedCompositionElaboratorId).toBe('keep-me')
    expect(result.selectedStyleElaboratorId).toBeNull()
  })

  describe('count', () => {
    it('floors fractional values', () => {
      expect(normalizeSessionDraft({ count: 2.9 }).count).toBe(2)
    })

    it('clamps below 1 up to 1', () => {
      expect(normalizeSessionDraft({ count: 0 }).count).toBe(1)
      expect(normalizeSessionDraft({ count: -5 }).count).toBe(1)
    })

    it('clamps above the max down to the max', () => {
      expect(normalizeSessionDraft({ count: 1_000_000 }).count).toBe(MAX_DRAFT_ITERATIONS)
    })

    it('falls back to 1 for non-finite or non-number values', () => {
      expect(normalizeSessionDraft({ count: NaN }).count).toBe(1)
      expect(normalizeSessionDraft({ count: Infinity }).count).toBe(1)
      expect(normalizeSessionDraft({ count: '5' }).count).toBe(1)
    })
  })

  describe('promptMode and targetScope', () => {
    it('keeps recognized values', () => {
      expect(normalizeSessionDraft({ promptMode: 'elaborated' }).promptMode).toBe('elaborated')
      expect(normalizeSessionDraft({ targetScope: 'all-drawthings' }).targetScope).toBe('all-drawthings')
    })

    it('rejects unknown values back to defaults', () => {
      expect(normalizeSessionDraft({ promptMode: 'wat' }).promptMode).toBe('as-is')
      expect(normalizeSessionDraft({ targetScope: 'everything' }).targetScope).toBe('selected')
    })
  })

  describe('selectedProprietary', () => {
    it('keeps only strictly-true known backends', () => {
      const result = normalizeSessionDraft({
        selectedProprietary: { openai: true, imagen: 1, grok: 'yes', flux: false },
      })
      expect(result.selectedProprietary.openai).toBe(true)
      // Truthy-but-not-true values are not selections.
      expect(result.selectedProprietary.imagen).toBe(false)
      expect(result.selectedProprietary.grok).toBe(false)
      expect(result.selectedProprietary.flux).toBe(false)
    })

    it('ignores unknown backend keys and always returns the full set', () => {
      const result = normalizeSessionDraft({
        selectedProprietary: { openai: true, midjourney: true },
      })
      expect(Object.keys(result.selectedProprietary).sort()).toEqual([...BACKEND_IDS_IN_UI_ORDER].sort())
      expect((result.selectedProprietary as Record<string, boolean>).midjourney).toBeUndefined()
    })

    it('defaults to all-false when the value is not a plain object', () => {
      const result = normalizeSessionDraft({ selectedProprietary: ['openai'] })
      for (const backend of BACKEND_IDS_IN_UI_ORDER) {
        expect(result.selectedProprietary[backend]).toBe(false)
      }
    })
  })

  describe('selectedDtFiles', () => {
    it('keeps only string entries', () => {
      expect(normalizeSessionDraft({ selectedDtFiles: ['a', 2, null, 'b', {}] }).selectedDtFiles).toEqual(['a', 'b'])
    })

    it('defaults to an empty array when not an array', () => {
      expect(normalizeSessionDraft({ selectedDtFiles: 'a.ckpt' }).selectedDtFiles).toEqual([])
    })
  })

  it('deep-copies nested fields so the result is detached from input', () => {
    const input = fullDraft()
    const result = normalizeSessionDraft(input)
    result.selectedProprietary.openai = false
    result.selectedDtFiles.push('mutated')
    expect(input.selectedProprietary.openai).toBe(true)
    expect(input.selectedDtFiles).toEqual(['model-a.ckpt', 'model-b.ckpt'])
  })
})
