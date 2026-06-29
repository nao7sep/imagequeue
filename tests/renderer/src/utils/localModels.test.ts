import { describe, expect, it } from 'vitest'
import { localModelName, partitionDrawThingsModels, sortLocalModels } from '../../../../src/renderer/src/utils/localModels'
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

describe('partitionDrawThingsModels', () => {
  it('puts a custom.json model whose file exists into local imports', () => {
    const models = [model({ file: 'import.ckpt', source: 'official', downloaded: true })]
    const { localImports, catalog } = partitionDrawThingsModels(models, new Set(['import.ckpt']))
    expect(localImports.map((m) => m.file)).toEqual(['import.ckpt'])
    expect(catalog).toEqual([])
  })

  it('silently drops a custom.json model whose file was deleted — not shown anywhere', () => {
    // The bug: a deleted import (downloaded:false) is still in custom.json, and the
    // CLI reports it as source:official. It must not leak into the catalog as a
    // broken "official" download.
    const models = [model({ file: 'import.ckpt', source: 'official', downloaded: false })]
    const { localImports, catalog } = partitionDrawThingsModels(models, new Set(['import.ckpt']))
    expect(localImports).toEqual([])
    expect(catalog).toEqual([])
  })

  it('keeps non-import models in the catalog regardless of download state', () => {
    const models = [
      model({ file: 'a.ckpt', source: 'official', downloaded: true }),
      model({ file: 'b.ckpt', source: 'community', downloaded: false })
    ]
    const { localImports, catalog } = partitionDrawThingsModels(models, new Set(['import.ckpt']))
    expect(localImports).toEqual([])
    expect(catalog.map((m) => m.file)).toEqual(['a.ckpt', 'b.ckpt'])
  })

  it('treats everything as catalog when there is no import ground truth (null)', () => {
    const models = [model({ file: 'a.ckpt', downloaded: true }), model({ file: 'b.ckpt', downloaded: false })]
    const { localImports, catalog } = partitionDrawThingsModels(models, null)
    expect(localImports).toEqual([])
    expect(catalog.map((m) => m.file)).toEqual(['a.ckpt', 'b.ckpt'])
  })
})
