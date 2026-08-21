import { describe, expect, it } from 'vitest'
import { resolveAdvancedTargets } from '../../../../src/renderer/src/utils/advancedTargets'

const models = [
  { file: 'b.ckpt', name: 'B' },
  { file: 'a.ckpt', name: 'A' },
] as never

describe('resolveAdvancedTargets', () => {
  it('filters selected targets by availability while preserving model order', () => {
    expect(resolveAdvancedTargets({
      scope: 'selected',
      selectedProprietary: { openai: true, grok: true },
      selectedDtFiles: ['a.ckpt'],
      downloadedDtModels: models,
      proprietaryEnabled: { openai: true, grok: false },
    })).toEqual({ proprietary: ['openai'], dt: ['a.ckpt'] })
  })

  it('resolves all and each all-* scope independently', () => {
    const base = {
      selectedProprietary: {},
      selectedDtFiles: [],
      downloadedDtModels: models,
      proprietaryEnabled: { openai: true, nanobanana: false, grok: true, flux: false },
    }
    expect(resolveAdvancedTargets({ ...base, scope: 'all-proprietary' })).toEqual({
      proprietary: ['openai', 'grok'], dt: [],
    })
    expect(resolveAdvancedTargets({ ...base, scope: 'all-drawthings' })).toEqual({
      proprietary: [], dt: ['b.ckpt', 'a.ckpt'],
    })
    expect(resolveAdvancedTargets({ ...base, scope: 'all' })).toEqual({
      proprietary: ['openai', 'grok'], dt: ['b.ckpt', 'a.ckpt'],
    })
  })
})
