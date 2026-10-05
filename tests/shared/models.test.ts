import { describe, expect, it } from 'vitest'
import { getModelsForBackend } from '../../src/shared/ai-models'
import { OPENAI_OUTPUT_FORMAT_LABELS } from '../../src/shared/models'

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
