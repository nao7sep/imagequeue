import { describe, expect, it } from 'vitest'
import {
  findModel,
  getDefaultModelForBackend,
  FLUX_MODELS,
  GROK_MODELS,
  IMAGEN_MODELS,
  IMAGEN_PERSON_GENERATION_LABELS,
  NANO_BANANA_MODELS,
  OPENAI_MODELS,
  OPENAI_OUTPUT_FORMAT_LABELS
} from '../../src/shared/models'

describe('model registry invariants', () => {
  const groups = [
    ['openai', OPENAI_MODELS],
    ['imagen', IMAGEN_MODELS],
    ['nanobanana', NANO_BANANA_MODELS],
    ['grok', GROK_MODELS],
    ['flux', FLUX_MODELS]
  ] as const

  it('has unique model ids within each backend', () => {
    for (const [, models] of groups) {
      const ids = models.map((m) => m.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('has exactly one default model per backend', () => {
    for (const [backend, models] of groups) {
      const defaults = models.filter((m) => m.isDefault)
      expect(defaults.length, `${backend} should have one default`).toBe(1)
    }
  })

  it('returns the marked default for every backend', () => {
    for (const [backend, models] of groups) {
      const expected = models.find((m) => m.isDefault)
      expect(getDefaultModelForBackend(backend), backend).toBe(expected)
    }
  })

  // Every option control renders from the model's own capability list, so a model
  // that declares none would render an empty dropdown the user cannot set. These
  // pin the fields each backend's panel reads — the whole point of ModelDef being
  // the sole source is that the registry, not the renderer, decides the options.
  it('declares the capabilities its panel renders, for every model', () => {
    for (const model of OPENAI_MODELS) {
      expect(model.qualities.length, model.id).toBeGreaterThan(0)
      expect(model.moderations.length, model.id).toBeGreaterThan(0)
      expect(model.outputFormats.length, model.id).toBeGreaterThan(0)
      expect(model.backgrounds.length, model.id).toBeGreaterThan(0)
      expect(model.sizes.length, model.id).toBeGreaterThan(0)
    }
    for (const model of IMAGEN_MODELS) {
      expect(model.aspectRatios.length, model.id).toBeGreaterThan(0)
      expect(model.imageSizes.length, model.id).toBeGreaterThan(0)
      expect(model.personGeneration.length, model.id).toBeGreaterThan(0)
    }
    for (const model of GROK_MODELS) {
      expect(model.aspectRatios.length, model.id).toBeGreaterThan(0)
      expect(model.resolutions.length, model.id).toBeGreaterThan(0)
    }
    for (const model of FLUX_MODELS) {
      expect(model.sizes.length, model.id).toBeGreaterThan(0)
    }
    for (const model of NANO_BANANA_MODELS) {
      expect(model.aspectRatios.length, model.id).toBeGreaterThan(0)
      expect(model.imageSizes.length, model.id).toBeGreaterThan(0)
    }
  })

  // A value with no label renders as a blank option. The maps are keyed by the
  // union type, so a *new* union member fails the typecheck — this catches the
  // other direction: a model declaring a value the map was never given.
  it('labels every option value its models declare', () => {
    for (const model of OPENAI_MODELS) {
      for (const format of model.outputFormats) {
        expect(OPENAI_OUTPUT_FORMAT_LABELS[format], `${model.id}/${format}`).toBeTruthy()
      }
    }
    for (const model of IMAGEN_MODELS) {
      for (const person of model.personGeneration) {
        expect(IMAGEN_PERSON_GENERATION_LABELS[person], `${model.id}/${person}`).toBeTruthy()
      }
    }
  })

})
