import { describe, expect, it } from 'vitest'
import {
  CLOUD_BACKENDS,
  fluxBackend,
  grokBackend,
  imagenBackend,
  nanoBananaBackend,
  openaiBackend,
} from '../../../../src/renderer/src/backends'
import {
  resolveSavedImageBackendDefaults,
  serializeImageBackendDefaults,
} from '../../../../src/renderer/src/utils/imageBackendDefaults'
import {
  findModel,
  getDefaultModelForBackend,
  getModelsForBackend,
} from '../../../../src/shared/models'
import { CLOUD_BACKEND_IDS_IN_UI_ORDER } from '../../../../src/shared/types'

describe('defaults', () => {
  it('pins each backend\'s fresh-column params', () => {
    expect(openaiBackend.defaults()).toEqual({
      width: 1024,
      height: 1024,
      moderation: 'auto',
      quality: 'auto',
      outputFormat: 'png',
      background: 'opaque',
    })
    expect(imagenBackend.defaults()).toEqual({ aspectRatio: '1:1', imageSize: '1K', personGeneration: 'allow_all' })
    expect(nanoBananaBackend.defaults()).toEqual({ aspectRatio: '1:1', imageSize: '1K' })
    expect(grokBackend.defaults()).toEqual({ aspectRatio: '1:1', resolution: '1k' })
    expect(fluxBackend.defaults()).toEqual({ sizeIdx: 0, steps: 50, guidance: 5, seed: '' })
  })
})

describe('clampToModel', () => {
  it('keeps valid OpenAI enum values and resets invalid ones to the model defaults', () => {
    const modelDef = findModel('openai', 'gpt-image-2')!
    const valid = openaiBackend.clampToModel(
      { width: 1024, height: 1024, moderation: 'low', quality: 'high', outputFormat: 'webp', background: 'auto' },
      modelDef
    )
    expect(valid).toEqual({ width: 1024, height: 1024, moderation: 'low', quality: 'high', outputFormat: 'webp', background: 'auto' })

    // gpt-image-2 offers no 'transparent' background — it falls to 'opaque'.
    const clamped = openaiBackend.clampToModel(
      { width: 1024, height: 1024, moderation: 'auto', quality: 'auto', outputFormat: 'png', background: 'transparent' },
      modelDef
    )
    expect(clamped.background).toBe('opaque')
  })

  it('resets a FLUX ranged value to the new model\'s range DEFAULT on a model switch', () => {
    const flex = findModel('flux', 'flux-2-flex')!
    const outOfRange = fluxBackend.clampToModel(
      { sizeIdx: 0, steps: flex.stepsRange!.max + 1, guidance: 5, seed: '' },
      flex
    )
    // Not clamped to the bound: a model switch takes the new model's default.
    expect(outOfRange.steps).toBe(flex.stepsRange!.default)
  })

  it('floors a FLUX size index that falls off a shorter ladder', () => {
    const flex = findModel('flux', 'flux-2-flex')!
    const clamped = fluxBackend.clampToModel({ sizeIdx: 999, steps: 30, guidance: 3, seed: '' }, flex)
    expect(clamped.sizeIdx).toBe(0)
  })

  it('leaves nano banana params untouched for a model without image config', () => {
    const unsupported = getModelsForBackend('nanobanana').find((m) => !m.supportsImageConfig)
    if (!unsupported) return // every model supports image config today; guard stays for a future one
    const params = { aspectRatio: '16:9', imageSize: '2K' }
    expect(nanoBananaBackend.clampToModel(params, unsupported)).toBe(params)
  })
})

describe('fromSaved', () => {
  it('clamps a saved FLUX ranged value to the nearest BOUND (user data, not a reset)', () => {
    const flex = findModel('flux', 'flux-2-flex')!
    const params = fluxBackend.fromSaved({ steps: 9999 }, flex)
    expect(params.steps).toBe(flex.stepsRange!.max)
  })
})

describe('saved/current serialization parity (the autosave dirty comparison)', () => {
  // The autosave hook compares serialize(saved.model, saved.params) with
  // serialize(model, toEnqueueParams(uiParams)). If the two shapes or key
  // orders diverge for any backend, every launch looks dirty and writes the
  // settings file once — FLUX had exactly that bug when the resolver spelled
  // its own params object. Deriving both sides from one toEnqueueParams makes
  // divergence impossible; this pins it.
  it.each(CLOUD_BACKEND_IDS_IN_UI_ORDER)('%s round-trips saved defaults to an identical snapshot', (backend) => {
    const models = getModelsForBackend(backend)
    const defaultModel = getDefaultModelForBackend(backend)
    const saved = resolveSavedImageBackendDefaults(
      backend,
      { model: defaultModel!.id, default_params: {} },
      models,
      defaultModel
    )!
    const descriptor = CLOUD_BACKENDS[backend]
    const modelDef = models.find((m) => m.id === saved.model)!
    const current = descriptor.toEnqueueParams(saved.ui, modelDef)
    expect(serializeImageBackendDefaults(saved.model, current))
      .toBe(serializeImageBackendDefaults(saved.model, saved.params))
  })
})
