import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { summarizeConfig } from '../../../src/main/config/summary'
import { createDefaultConfig } from '../../../src/main/config/defaults'
import { setStoredApiKey } from '../../../src/main/config/api-keys-store'
import { CLOUD_BACKEND_IDS_IN_UI_ORDER } from '../../../src/shared/types'
import type { AppConfig } from '../../../src/main/config/types'

const ENV_VAR = 'IMAGEQUEUE_HOME'

describe('summarizeConfig', () => {
  let tmpRoot: string
  const originalHome = process.env[ENV_VAR]
  // Image-backend env overrides could otherwise mask the stored-key assertions.
  const maskedEnv = [
    'OPENAI_IMAGE_API_KEY',
    'OPENAI_API_KEY',
    'GEMINI_TEXT_API_KEY',
    'GEMINI_API_KEY',
  ]
  const savedEnv = new Map<string, string | undefined>()

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-summary-'))
    process.env[ENV_VAR] = tmpRoot
    for (const name of maskedEnv) {
      savedEnv.set(name, process.env[name])
      delete process.env[name]
    }
  })

  afterEach(() => {
    if (originalHome === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = originalHome
    for (const [name, value] of savedEnv) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    savedEnv.clear()
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('includes every cloud backend and never leaks a raw api key', () => {
    const config = createDefaultConfig()
    // Keys live in the separate secrets store now, not config.json.
    setStoredApiKey('openai.image', 'sk-super-secret')

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

  it('reports no key present when none is stored or in the environment', () => {
    const summary = summarizeConfig(createDefaultConfig()) as {
      imageBackends: Record<string, { apiKeyPresent: boolean }>
    }
    expect(summary.imageBackends.openai.apiKeyPresent).toBe(false)
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
