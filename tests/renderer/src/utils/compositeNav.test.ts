import { describe, expect, it } from 'vitest'
import {
  indexOfId,
  nextIndex,
} from '../../../../src/renderer/src/utils/compositeNav'

// Pure index math runs without a DOM. Separate renderer interaction suites
// cover focus, roving tab stops, ARIA selection, menu dismissal and IME keys.

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
