import { describe, expect, it } from 'vitest'
import {
  currentCompositeIndex,
  indexOfId,
  nextIndex,
  removalFocusTargetId,
} from '../../../../src/renderer/src/utils/compositeNav'

// These tests cover only the pure index/recovery math behind the app's composite
// controls (useListbox and the multi-column queue board). The behaviors that
// depend on a live DOM — roving tabindex, real focus movement, the aria
// projections, Tab moving between the queue's columns, the queue's geometry-based
// Left/Right cross-column switch, the menu's focus-into/return-to-trigger and
// submenu open/close, and IME-guarded type-ahead — are DOM-only and are verified
// by manual QA, not here. This suite runs in the node environment with no jsdom,
// matching the rest of the renderer unit tests.

describe('nextIndex', () => {
  it('steps forward and backward one item at a time', () => {
    expect(nextIndex('next', 1, 4)).toBe(2)
    expect(nextIndex('prev', 2, 4)).toBe(1)
  })

  it('stops at the ends rather than wrapping', () => {
    expect(nextIndex('next', 3, 4)).toBe(3)
    expect(nextIndex('prev', 0, 4)).toBe(0)
  })

  it('enters at the first item on next and the last on prev when nothing is current', () => {
    expect(nextIndex('next', -1, 4)).toBe(0)
    expect(nextIndex('prev', -1, 4)).toBe(3)
  })

  it('jumps to the ends with first/last regardless of the current index', () => {
    expect(nextIndex('first', 2, 4)).toBe(0)
    expect(nextIndex('last', 1, 4)).toBe(3)
    expect(nextIndex('first', -1, 4)).toBe(0)
    expect(nextIndex('last', -1, 4)).toBe(3)
  })

  it('stays on the only item in a single-item set', () => {
    expect(nextIndex('next', 0, 1)).toBe(0)
    expect(nextIndex('prev', 0, 1)).toBe(0)
    expect(nextIndex('first', 0, 1)).toBe(0)
    expect(nextIndex('last', 0, 1)).toBe(0)
  })

  it('returns -1 for an empty set', () => {
    expect(nextIndex('next', -1, 0)).toBe(-1)
    expect(nextIndex('prev', -1, 0)).toBe(-1)
    expect(nextIndex('first', -1, 0)).toBe(-1)
    expect(nextIndex('last', -1, 0)).toBe(-1)
  })
})

describe('indexOfId', () => {
  it('finds an id and reports -1 for null/undefined or a missing id', () => {
    expect(indexOfId(['a', 'b', 'c'], 'b')).toBe(1)
    expect(indexOfId(['a', 'b', 'c'], 'z')).toBe(-1)
    expect(indexOfId(['a', 'b', 'c'], null)).toBe(-1)
    expect(indexOfId(['a', 'b', 'c'], undefined)).toBe(-1)
  })
})

describe('currentCompositeIndex', () => {
  const ids = ['a', 'b', 'c']

  it('uses the focused item before the locally active or selected item', () => {
    expect(currentCompositeIndex({ ids, focusedId: 'c', activeId: 'b', selectedId: 'a' })).toBe(2)
  })

  it('uses the locally active item before a stale selected prop', () => {
    expect(currentCompositeIndex({ ids, activeId: 'b', selectedId: 'a' })).toBe(1)
  })

  it('falls back to selected and then no current item', () => {
    expect(currentCompositeIndex({ ids, selectedId: 'a' })).toBe(0)
    expect(currentCompositeIndex({ ids, focusedId: 'missing', activeId: 'missing', selectedId: 'missing' })).toBe(-1)
  })
})

describe('removalFocusTargetId', () => {
  it('keeps focus at the same index when a later item slides into place', () => {
    expect(removalFocusTargetId(['a', 'c'], 1)).toBe('c')
  })

  it('falls back to the previous item after removing the last item', () => {
    expect(removalFocusTargetId(['a', 'b'], 2)).toBe('b')
  })

  it('returns null when the list becomes empty', () => {
    expect(removalFocusTargetId([], 0)).toBeNull()
  })
})
