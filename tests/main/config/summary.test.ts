import { describe, expect, it } from 'vitest'
import { summarizeConfig } from '../../../src/main/config/summary'
import { createDefaultConfig } from '../../../src/main/config/defaults'
import { CLOUD_BACKEND_IDS_IN_UI_ORDER } from '../../../src/shared/types'
import type { AppConfig } from '../../../src/main/config/types'

describe('summarizeConfig', () => {
  it('includes every cloud backend and never leaks a raw api key', () => {
    const config = createDefaultConfig()
    config.image_backends.openai.api_key = 'sk-super-secret'

    const summary = summarizeConfig(config) as {
      imageBackends: Record<string, { apiKeyPresent: boolean }>
    }

    for (const id of CLOUD_BACKEND_IDS_IN_UI_ORDER) {
      expect(summary.imageBackends[id]).toBeDefined()
    }
    expect(summary.imageBackends.drawthings).toBeDefined()
    expect(summary.imageBackends.openai.apiKeyPresent).toBe(true)
    // The summary emits presence booleans only — the raw key must not appear.
    expect(JSON.stringify(summary)).not.toContain('sk-super-secret')
  })

  it('does not throw on a malformed config with null nested sections', () => {
    // deepMergeDefaults preserves a malformed nested section verbatim, so a
    // hand-edited config.json can present null where an object is expected.
    // summarizeConfig runs at startup and must never crash window creation.
    const malformed = {
      text_ai: null,
      image_backends: null,
      general: null,
      notifications: null,
    } as unknown as AppConfig

    expect(() => summarizeConfig(malformed)).not.toThrow()

    const summary = summarizeConfig(malformed) as {
      textAi: { geminiApiKeyPresent: boolean }
      imageBackends: Record<string, { apiKeyPresent: boolean }>
    }
    expect(summary.textAi.geminiApiKeyPresent).toBe(false)
    expect(summary.imageBackends.openai.apiKeyPresent).toBe(false)
  })
})
