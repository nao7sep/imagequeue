import { describe, expect, it } from 'vitest'
import {
  CLOUD_BACKENDS,
  fluxBackend,
  grokBackend,
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
} from '../../../../src/shared/ai-models'
import { CLOUD_BACKEND_IDS_IN_UI_ORDER } from '../../../../src/shared/types'

describe('defaults', () => {
  it('pins each backend\'s fresh-column params', () => {
    expect(openaiBackend.defaults()).toEqual({
      width: 1024,
      height: 1024,
      quality: 'auto',
      outputFormat: 'png',
      outputCompression: 100,
      background: 'auto',
    })
    expect(nanoBananaBackend.defaults()).toEqual({ aspectRatio: '1:1', imageSize: '1K', thinking: 'minimal' })
    expect(grokBackend.defaults()).toEqual({ aspectRatio: '1:1', resolution: '1k', quality: 'auto' })
    expect(fluxBackend.defaults()).toEqual({ sizeIdx: 0, outputFormat: 'png', steps: 50, guidance: 5, seed: '', aspectRatio: '1:1', resolution: '1k' })
  })
})

describe('clampToModel', () => {
  it('keeps valid OpenAI enum values and resets invalid ones to the model defaults', () => {
    const flare = findModel('openai', 'gpt-image-2.5-flare')!
    const gpt2 = findModel('openai', 'gpt-image-2')!
    const chosen = { width: 1024, height: 1024, quality: 'xhigh' as const, outputFormat: 'webp' as const, outputCompression: 80, background: 'opaque' as const }
    expect(openaiBackend.clampToModel(chosen, flare)).toEqual(chosen)
    // gpt-image-2 does not take xhigh, so a switch to it resets quality to auto.
    expect(openaiBackend.clampToModel(chosen, gpt2)).toEqual({ ...chosen, quality: 'auto' })
  })

  it('limits a transparent background to png and webp', () => {
    const flare = findModel('openai', 'gpt-image-2.5-flare')!
    const jpeg = { ...openaiBackend.defaults(), outputFormat: 'jpeg' as const, background: 'transparent' as const }
    expect(openaiBackend.clampToModel(jpeg, flare).outputFormat).toBe('png')
    const webp = { ...jpeg, outputFormat: 'webp' as const }
    expect(openaiBackend.clampToModel(webp, flare).outputFormat).toBe('webp')
  })

  it('enqueues compression for jpeg and webp only', () => {
    const flare = findModel('openai', 'gpt-image-2.5-flare')!
    const params = openaiBackend.defaults()
    expect(openaiBackend.toEnqueueParams(params, flare)).toEqual({ width: 1024, height: 1024, quality: 'auto', outputFormat: 'png', background: 'auto' })
    expect(openaiBackend.toEnqueueParams({ ...params, outputFormat: 'jpeg', outputCompression: 0 }, flare)).toHaveProperty('outputCompression', 0)
  })

  it('resets a FLUX ranged value to the new model\'s range DEFAULT on a model switch', () => {
    const flex = findModel('flux', 'flux-2-flex')!
    const outOfRange = fluxBackend.clampToModel(
      { ...fluxBackend.defaults(), steps: flex.stepsRange!.max + 1 },
      flex
    )
    // Not clamped to the bound: a model switch takes the new model's default.
    expect(outOfRange.steps).toBe(flex.stepsRange!.default)
  })

  it('floors a FLUX size index that falls off a shorter ladder', () => {
    const flex = findModel('flux', 'flux-2-flex')!
    const clamped = fluxBackend.clampToModel({ ...fluxBackend.defaults(), sizeIdx: 999 }, flex)
    expect(clamped.sizeIdx).toBe(0)
  })

  it('enqueues FLUX 3 its ratio and resolution only, and FLUX.2 its size, format and seed', () => {
    const flux3 = findModel('flux', 'flux-3-image')!
    const pro = findModel('flux', 'flux-2-pro')!
    const params = { ...fluxBackend.defaults(), outputFormat: 'webp' as const, seed: '7', aspectRatio: 'auto', resolution: '768sq' }
    expect(fluxBackend.toEnqueueParams(params, flux3)).toEqual({ aspectRatio: 'auto', resolution: '768sq' })
    expect(fluxBackend.toEnqueueParams(params, pro)).toEqual({ width: 1024, height: 1024, outputFormat: 'webp', seed: 7 })
  })

  it('keeps each FLUX kind\'s choices across a switch, and falls to 1:1, 1k and png', () => {
    const flux3 = findModel('flux', 'flux-3-image')!
    const pro = findModel('flux', 'flux-2-pro')!
    expect(fluxBackend.fromSaved({}, flux3)).toMatchObject({ aspectRatio: '1:1', resolution: '1k', outputFormat: 'png' })
    expect(fluxBackend.fromSaved({ aspectRatio: '9:21', resolution: '4k' }, flux3)).toMatchObject({ aspectRatio: '9:21', resolution: '4k' })
    expect(fluxBackend.fromSaved({ aspectRatio: '8:1', resolution: '8k' }, flux3)).toMatchObject({ aspectRatio: '1:1', resolution: '1k' })
    const onPro = fluxBackend.clampToModel({ ...fluxBackend.defaults(), aspectRatio: '16:9', outputFormat: 'jpeg' }, pro)
    expect(onPro).toMatchObject({ aspectRatio: '16:9', outputFormat: 'jpeg' })
    expect(fluxBackend.clampToModel(onPro, flux3)).toMatchObject({ aspectRatio: '16:9', outputFormat: 'jpeg' })
  })

  it('resets Gemini thinking to the new model\'s default and keeps a ratio and size it takes', () => {
    const pro = findModel('nanobanana', 'gemini-3-pro-image')!
    const flash = findModel('nanobanana', 'gemini-3.1-flash-image')!
    const lite = findModel('nanobanana', 'gemini-3.1-flash-lite-image')!
    expect(nanoBananaBackend.clampToModel({ aspectRatio: '16:9', imageSize: '2K', thinking: 'high' }, pro)).toEqual({ aspectRatio: '16:9', imageSize: '2K', thinking: 'medium' })
    expect(nanoBananaBackend.clampToModel({ aspectRatio: '8:1', imageSize: '512', thinking: 'medium' }, flash)).toEqual({ aspectRatio: '8:1', imageSize: '512', thinking: 'minimal' })
    // Pro takes neither 8:1 nor 512, so they fall to 1:1 and 1K.
    expect(nanoBananaBackend.clampToModel({ aspectRatio: '8:1', imageSize: '512', thinking: 'high' }, pro)).toEqual({ aspectRatio: '1:1', imageSize: '1K', thinking: 'medium' })
    expect(nanoBananaBackend.clampToModel({ aspectRatio: '1:1', imageSize: '4K', thinking: 'high' }, lite)).toEqual({ aspectRatio: '1:1', imageSize: '1K', thinking: 'minimal' })
  })

  it('keeps a saved Gemini thinking the row takes, else the row\'s default, and sizes fall to 1K', () => {
    const flash = findModel('nanobanana', 'gemini-3.1-flash-image')!
    expect(nanoBananaBackend.fromSaved({ thinking: 'high' }, flash)).toEqual({ aspectRatio: '1:1', imageSize: '1K', thinking: 'high' })
    expect(nanoBananaBackend.fromSaved({ thinking: 'low', imageSize: 'bogus' }, flash)).toEqual({ aspectRatio: '1:1', imageSize: '1K', thinking: 'minimal' })
  })
})

describe('fromSaved', () => {
  it('clamps a saved FLUX ranged value to the nearest BOUND (user data, not a reset)', () => {
    const flex = findModel('flux', 'flux-2-flex')!
    const params = fluxBackend.fromSaved({ steps: 9999 }, flex)
    expect(params.steps).toBe(flex.stepsRange!.max)
  })
})

describe('grok quality — a parameter only one model declares', () => {
  const v2 = findModel('grok', 'grok-imagine-image-2.0')!
  const v1 = findModel('grok', 'grok-imagine-image')!

  // 2.0 takes `quality` as a request field; grok-imagine-image has no quality
  // choice, so the field is not sent there.
  it('enqueues quality for 2.0 and omits it for grok-imagine-image', () => {
    const params = grokBackend.defaults()
    expect(grokBackend.toEnqueueParams(params, v2)).toHaveProperty('quality', 'auto')
    expect(grokBackend.toEnqueueParams(params, v1)).not.toHaveProperty('quality')
  })

  // Only 2.0 declares the list, so only 2.0 renders the control.
  it('declares qualities on 2.0 alone', () => {
    // `auto` was live-verified with a successful generation; 2.0 still rejects `high`.
    expect(v2.qualities?.map((q) => q.value)).toEqual(['auto', 'low', 'medium'])
    expect(v1.qualities).toBeUndefined()
  })

  // The value is HELD while hidden rather than reset: a user who picks low, switches to
  // grok-imagine-image and comes back should find low, not the default. This is the flux steps rule.
  // ('low' and not 'high' — 2.0 rejects high, so a test using it would assert a state the
  // app can never legitimately be in.)
  it('keeps a chosen quality across a switch to a model that does not declare it', () => {
    const chosen = { ...grokBackend.defaults(), quality: 'low' as const }
    expect(chosen.quality).not.toBe(grokBackend.defaults().quality)  // a real change, not the default
    const onV1 = grokBackend.clampToModel(chosen, v1)
    expect(onV1.quality).toBe('low')
    expect(grokBackend.clampToModel(onV1, v2).quality).toBe('low')
  })

  // An unreadable saved value falls to `auto` (the API's own default), NOT to the list's
  // first entry — positional clamping here would silently pin output to `low`.
  it('falls back to auto, not to the first list entry', () => {
    expect(grokBackend.fromSaved({ quality: 'ultra' }, v2).quality).toBe('auto')
  })

  it('falls back to 1:1 and 1k, not to the lists\' first entries, and keeps 1.5k only where the row takes it', () => {
    expect(grokBackend.fromSaved({}, v2)).toEqual({ aspectRatio: '1:1', resolution: '1k', quality: 'auto' })
    expect(grokBackend.fromSaved({ aspectRatio: 'auto', resolution: '1.5k' }, v2)).toMatchObject({ aspectRatio: 'auto', resolution: '1.5k' })
    expect(grokBackend.clampToModel({ aspectRatio: '21:9', resolution: '1.5k', quality: 'medium' }, v1)).toMatchObject({ aspectRatio: '21:9', resolution: '1k' })
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
