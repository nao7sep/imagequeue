import { describe, expect, it } from 'vitest'
import {
  buildAdvancedQueueUnits,
  promptTextForUnit,
  promptsNeeded,
} from '../../../../src/renderer/src/utils/advancedQueueUnits'

// The batch contract behind Queue Tasks. The count promise the button makes
// (targets × iterations) is honest only if this dealing is exact — an error
// here spends image-generation money in multiples.

describe('promptsNeeded', () => {
  it('one shared prompt for as-is and elaborated, whatever the batch size', () => {
    expect(promptsNeeded('as-is', 5, 4)).toBe(1)
    expect(promptsNeeded('elaborated', 3, 2)).toBe(1)
  })

  it('one per iteration, and one per target×iteration', () => {
    expect(promptsNeeded('fresh-iteration', 5, 4)).toBe(5)
    expect(promptsNeeded('fresh-task', 5, 4)).toBe(20)
  })
})

describe('promptTextForUnit', () => {
  it('deals fresh-task iteration-major: iteration 0 across every target first', () => {
    const prompts = ['t0c0', 't1c0', 't2c0', 't0c1', 't1c1', 't2c1']
    const dealt: string[] = []
    for (let c = 0; c < 2; c++) {
      for (let t = 0; t < 3; t++) dealt.push(promptTextForUnit('fresh-task', prompts, t, c, 3))
    }
    expect(dealt).toEqual(prompts)
  })

  it('shares one prompt across targets within an iteration for fresh-iteration', () => {
    const prompts = ['iter0', 'iter1']
    expect(promptTextForUnit('fresh-iteration', prompts, 0, 1, 3)).toBe('iter1')
    expect(promptTextForUnit('fresh-iteration', prompts, 2, 1, 3)).toBe('iter1')
  })

  it('reuses the single prompt for as-is and elaborated', () => {
    expect(promptTextForUnit('as-is', ['only'], 2, 4, 3)).toBe('only')
    expect(promptTextForUnit('elaborated', ['only'], 0, 0, 1)).toBe('only')
  })

  // A shortfall is a broken engine invariant. The modulo this replaced would
  // have silently duplicated prompts across tasks instead of surfacing it.
  it('throws on a shortfall rather than wrapping around', () => {
    expect(() => promptTextForUnit('fresh-task', ['a', 'b'], 2, 0, 3)).toThrow(/missing/)
    expect(() => promptTextForUnit('fresh-iteration', ['a'], 0, 1, 3)).toThrow(/missing/)
  })
})

describe('buildAdvancedQueueUnits', () => {
  it('builds one iteration-major batch across cloud and local targets', () => {
    const targets = [
      { backend: 'openai' as const, model: 'cloud', params: { quality: 'low' } },
      { backend: 'drawthings' as const, model: 'local', params: { steps: 4 } },
    ]
    const units = buildAdvancedQueueUnits({
      mode: 'fresh-task',
      prompts: ['cloud-0', 'local-0', 'cloud-1', 'local-1'],
      copies: 2,
      targets,
    })

    expect(units.map((unit) => [unit.backend, unit.prompt])).toEqual([
      ['openai', 'cloud-0'],
      ['drawthings', 'local-0'],
      ['openai', 'cloud-1'],
      ['drawthings', 'local-1'],
    ])
    expect(units[1].params).toEqual({ steps: 4 })
  })
})
