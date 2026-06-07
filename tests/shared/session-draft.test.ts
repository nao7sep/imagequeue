import { describe, expect, it } from 'vitest'
import {
  createEmptySessionDraft,
  MAX_DRAFT_ITERATIONS,
  normalizeCount,
  normalizeSessionDraft,
  PROMPT_FORMATS,
  PROMPT_LENGTHS,
  PROMPT_FORMAT_LABELS,
  PROMPT_LENGTH_LABELS,
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
    promptFormat: 'phrases',
    promptLength: 'long',
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
    expect(draft.promptFormat).toBe('sentences')
    expect(draft.promptLength).toBe('medium')
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
    expect(result.promptFormat).toBe('sentences')
    expect(result.promptLength).toBe('medium')
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

  describe('promptFormat and promptLength', () => {
    it('keeps recognized values', () => {
      expect(normalizeSessionDraft({ promptFormat: 'sentences' }).promptFormat).toBe('sentences')
      expect(normalizeSessionDraft({ promptLength: 'short' }).promptLength).toBe('short')
    })

    it('rejects unknown values back to defaults', () => {
      expect(normalizeSessionDraft({ promptFormat: 'haiku' }).promptFormat).toBe('sentences')
      expect(normalizeSessionDraft({ promptLength: 'epic' }).promptLength).toBe('medium')
    })

    it('rejects wrong-typed values back to defaults', () => {
      expect(normalizeSessionDraft({ promptFormat: 42, promptLength: null }).promptFormat).toBe('sentences')
      expect(normalizeSessionDraft({ promptFormat: 42, promptLength: null }).promptLength).toBe('medium')
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

// Exported and consumed directly by the Advanced Prompting count input
// (normalizeCount(parseInt(value, 10))), so its contract is locked here at its
// own boundary, not only through normalizeSessionDraft.
describe('normalizeCount', () => {
  it('returns 1 for a NaN from a failed parse (empty/invalid input field)', () => {
    expect(normalizeCount(parseInt('', 10))).toBe(1)
    expect(normalizeCount(parseInt('abc', 10))).toBe(1)
    expect(normalizeCount(NaN)).toBe(1)
  })

  it('floors fractional values', () => {
    expect(normalizeCount(2.9)).toBe(2)
  })

  it('clamps below 1 up to 1', () => {
    expect(normalizeCount(0)).toBe(1)
    expect(normalizeCount(-5)).toBe(1)
  })

  it('clamps above the max down to the max', () => {
    expect(normalizeCount(1_000_000)).toBe(MAX_DRAFT_ITERATIONS)
    expect(normalizeCount(MAX_DRAFT_ITERATIONS)).toBe(MAX_DRAFT_ITERATIONS)
  })

  it('passes a valid in-range count through unchanged', () => {
    expect(normalizeCount(5)).toBe(5)
  })

  it('returns 1 for non-finite or non-number input', () => {
    expect(normalizeCount(Infinity)).toBe(1)
    expect(normalizeCount('5')).toBe(1)
    expect(normalizeCount(undefined)).toBe(1)
  })
})

// The label maps are the single source shared by the Advanced Prompting picker
// and the Elaboration Settings editor; these guard against a tier being added
// without a label (or a stale label outliving its enum value).
describe('prompt format/length labels', () => {
  it('has exactly one non-empty label per format', () => {
    expect(Object.keys(PROMPT_FORMAT_LABELS).sort()).toEqual([...PROMPT_FORMATS].sort())
    for (const format of PROMPT_FORMATS) {
      expect(PROMPT_FORMAT_LABELS[format].trim().length).toBeGreaterThan(0)
    }
  })

  it('has exactly one non-empty label per length', () => {
    expect(Object.keys(PROMPT_LENGTH_LABELS).sort()).toEqual([...PROMPT_LENGTHS].sort())
    for (const length of PROMPT_LENGTHS) {
      expect(PROMPT_LENGTH_LABELS[length].trim().length).toBeGreaterThan(0)
    }
  })
})
