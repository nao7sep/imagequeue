import { describe, expect, it } from 'vitest'
import { getModelsForBackend } from '../../src/shared/ai-models'
import { DRAWTHINGS_SIZE_PRESETS, OPENAI_OUTPUT_FORMAT_LABELS, drawThingsDimension } from '../../src/shared/models'

describe('image option labels', () => {
  // A value with no label renders as a blank option. The map is keyed by the
  // union type, so a *new* union member fails the typecheck — this catches the
  // other direction: a row declaring a value the map was never given.
  it('labels every output format an OpenAI row declares', () => {
    for (const model of getModelsForBackend('openai')) {
      for (const format of model.outputFormats) {
        expect(OPENAI_OUTPUT_FORMAT_LABELS[format], `${model.id}/${format}`).toBeTruthy()
      }
    }
  })
})

// Draw Things' CLI refuses any size that is not a multiple of 64.
describe('Draw Things sizes', () => {
  it('offers only multiples of 64, each the nearest to the standard size', () => {
    for (const { width, height } of DRAWTHINGS_SIZE_PRESETS) {
      expect(width % 64, `${width}×${height}`).toBe(0)
      expect(height % 64, `${width}×${height}`).toBe(0)
    }
    expect(DRAWTHINGS_SIZE_PRESETS.find((preset) => preset.shape === 'uhdWide')).toMatchObject({ width: 3840, height: 2176 })
  })

  it('snaps any requested dimension to the nearest multiple of 64, at least 64', () => {
    expect([1000, 2160, 1440, 64, 10, 0].map(drawThingsDimension)).toEqual([1024, 2176, 1472, 64, 64, 64])
  })
})

