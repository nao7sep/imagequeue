import { afterEach, describe, expect, it } from 'vitest'
import {
  isAnyModalOpen,
  isTopmostModal,
  popModal,
  pushModal
} from '../../../../src/renderer/src/components/modalStack'

// The stack is module-global, so every test leaves it empty for the next one.
// This guard fails loudly if any test forgets to clean up.
afterEach(() => {
  expect(isAnyModalOpen()).toBe(false)
})

describe('modalStack', () => {
  it('reports nothing open and nothing topmost when empty', () => {
    expect(isAnyModalOpen()).toBe(false)
    expect(isTopmostModal('anything')).toBe(false)
  })

  it('tracks a single modal as open and topmost', () => {
    pushModal('a')
    expect(isAnyModalOpen()).toBe(true)
    expect(isTopmostModal('a')).toBe(true)
    popModal('a')
  })

  it('treats only the last-pushed modal as topmost when stacked', () => {
    pushModal('a')
    pushModal('b')
    expect(isTopmostModal('a')).toBe(false)
    expect(isTopmostModal('b')).toBe(true)
    popModal('b')
    expect(isTopmostModal('a')).toBe(true)
    popModal('a')
  })

  it('keeps the stack intact when a mid-stack modal is removed out of order', () => {
    // e.g. a non-topmost modal unmounts on its own while a confirm sits above it.
    pushModal('a')
    pushModal('b')
    pushModal('c')
    popModal('b')
    expect(isAnyModalOpen()).toBe(true)
    expect(isTopmostModal('c')).toBe(true)
    expect(isTopmostModal('a')).toBe(false)
    popModal('c')
    expect(isTopmostModal('a')).toBe(true)
    popModal('a')
  })

  it('ignores popping an unknown id and never underflows on a double pop', () => {
    pushModal('a')
    popModal('ghost')
    expect(isAnyModalOpen()).toBe(true)
    expect(isTopmostModal('a')).toBe(true)
    popModal('a')
    popModal('a')
    expect(isAnyModalOpen()).toBe(false)
  })
})
