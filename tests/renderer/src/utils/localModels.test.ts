import { describe, expect, it } from 'vitest'
import { localModelName, sortLocalModels } from '../../../../src/renderer/src/utils/localModels'
import type { LocalModelInfo } from '../../../../src/shared/types'

function model(partial: Partial<LocalModelInfo>): LocalModelInfo {
  return { file: '', name: '', source: '', downloaded: false, huggingFace: null, ...partial }
}

describe('localModelName', () => {
  it('prefers the display name and falls back to the filename', () => {
    expect(localModelName(model({ name: 'Flux Dev', file: 'flux.ckpt' }))).toBe('Flux Dev')
    expect(localModelName(model({ name: '', file: 'flux.ckpt' }))).toBe('flux.ckpt')
  })
})

describe('sortLocalModels', () => {
  it('sorts case-insensitively with natural numeric ordering', () => {
    const input = [
      model({ name: 'Model 10', file: 'm10' }),
      model({ name: 'model 2', file: 'm2' }),
      model({ name: 'Model 1', file: 'm1' })
    ]
    expect(sortLocalModels(input).map((m) => m.name)).toEqual(['Model 1', 'model 2', 'Model 10'])
  })

  it('does not mutate the input array', () => {
    const input = [model({ name: 'b' }), model({ name: 'a' })]
    const snapshot = input.map((m) => m.name)
    sortLocalModels(input)
    expect(input.map((m) => m.name)).toEqual(snapshot)
  })
})
