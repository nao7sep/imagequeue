import { describe, expect, it } from 'vitest'
import { isBrainstormMode } from '../../../../src/renderer/src/utils/promptMode'

describe('isBrainstormMode', () => {
  it('is true for the fresh-* modes that generate new prompts', () => {
    expect(isBrainstormMode('fresh-iteration')).toBe(true)
    expect(isBrainstormMode('fresh-task')).toBe(true)
  })

  it('is false for modes that reuse existing text', () => {
    expect(isBrainstormMode('as-is')).toBe(false)
    expect(isBrainstormMode('elaborated')).toBe(false)
  })
})
