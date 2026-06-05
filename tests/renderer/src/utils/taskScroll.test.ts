import { describe, expect, it } from 'vitest'
import { isFreshCompletion } from '../../../../src/renderer/src/utils/taskScroll'

describe('isFreshCompletion', () => {
  it('is true on a real transition into completed', () => {
    expect(isFreshCompletion('queued', 'completed')).toBe(true)
    expect(isFreshCompletion('generating', 'completed')).toBe(true)
  })

  it('is false when the item was already completed (e.g. mounted from storage)', () => {
    expect(isFreshCompletion('completed', 'completed')).toBe(false)
  })

  it('is false for kept — revealing kept images must not scroll', () => {
    expect(isFreshCompletion('kept', 'kept')).toBe(false)
    expect(isFreshCompletion('completed', 'kept')).toBe(false)
  })

  it('is false for non-completed transitions', () => {
    expect(isFreshCompletion('queued', 'generating')).toBe(false)
    expect(isFreshCompletion('generating', 'failed')).toBe(false)
    expect(isFreshCompletion('queued', 'interrupted')).toBe(false)
  })
})
