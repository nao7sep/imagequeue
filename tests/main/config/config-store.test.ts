import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deepMergeDefaults } from '../../../src/main/config/config-store'
import { createDefaultConfig } from '../../../src/main/config/defaults'

// The security property behind keys living outside the config type: the shipped
// config shape has nowhere to PUT a key, so config.json is key-free by
// construction rather than by a scrub list somebody must extend when a provider
// is added. A key reaching that file would be copied into the add-only backup
// history, which has no prune path to retract it.
//
// This asserts against the default config object rather than the written file on
// purpose: the written file is also swept by dropLegacyConfigKeys, so a test
// reading it would still pass with this property broken.
describe('the config shape cannot carry an api key', () => {
  function apiKeyPaths(value: unknown, trail: string[] = []): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    return Object.entries(value).flatMap(([key, child]) =>
      key === 'api_key'
        ? [[...trail, key].join('.')]
        : apiKeyPaths(child, [...trail, key])
    )
  }

  it('has no api_key field anywhere in the shipped defaults', () => {
    expect(apiKeyPaths(createDefaultConfig())).toEqual([])
  })
})

describe('deepMergeDefaults', () => {
  it('fills structurally absent keys from defaults', () => {
    expect(deepMergeDefaults({ a: 1 }, { a: 0, b: 2 })).toEqual({ a: 1, b: 2 })
  })

  it('preserves explicit falsy values rather than overwriting with defaults', () => {
    const loaded = { enabled: false, count: 0, name: '', nothing: null }
    const defaults = { enabled: true, count: 5, name: 'def', nothing: 'def' }
    expect(deepMergeDefaults(loaded, defaults)).toEqual(loaded)
  })

  it('merges nested objects recursively', () => {
    const loaded = { general: { a: 1 } }
    const defaults = { general: { a: 0, b: 2 }, extra: { c: 3 } }
    expect(deepMergeDefaults(loaded, defaults)).toEqual({ general: { a: 1, b: 2 }, extra: { c: 3 } })
  })

  it('keeps loaded arrays verbatim instead of merging element-wise', () => {
    const loaded = { items: [1] }
    const defaults = { items: [9, 9, 9] }
    expect(deepMergeDefaults(loaded, defaults)).toEqual({ items: [1] })
  })

  it('preserves user keys that are absent from defaults', () => {
    expect(deepMergeDefaults({ extra: 'keep' }, { known: 1 }))
      .toEqual({ extra: 'keep', known: 1 })
  })

  it('returns defaults when the loaded value is not a plain object', () => {
    const defaults = { a: 1 }
    expect(deepMergeDefaults(undefined, defaults)).toBe(defaults)
    expect(deepMergeDefaults('not an object', defaults)).toBe('not an object')
  })
})

// deepMergeDefaults deliberately keeps loaded keys that defaults no longer has
// (the test above pins that), so a removed schema key would otherwise live in the
// user's config forever. These prove the removals are actually swept.
describe('legacy config keys', () => {
  const ENV_VAR = 'IMAGEQUEUE_HOME'
  let tmpRoot: string
  const originalHome = process.env[ENV_VAR]

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-config-'))
    process.env[ENV_VAR] = tmpRoot
    // loadConfig memoizes into a module-level cache, so each case needs a fresh
    // module instance rather than a test-only reset export on the store.
    vi.resetModules()
  })

  afterEach(() => {
    if (originalHome === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = originalHome
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  async function loadWritten(config: unknown): Promise<Record<string, never>> {
    fs.writeFileSync(path.join(tmpRoot, 'config.json'), JSON.stringify(config), 'utf-8')
    const { loadConfig } = await import('../../../src/main/config/config-store')
    return loadConfig() as unknown as Record<string, never>
  }

  it('drops the Imagen backend block a pre-removal config still carries', async () => {
    const loaded = await loadWritten({
      image_backends: {
        imagen: { api_key: '', model: 'imagen-4.0-generate-001', concurrency: 3, timeout_ms: 180000 },
      },
    })
    const backends = loaded.image_backends as unknown as Record<string, unknown>
    expect(backends).not.toHaveProperty('imagen')
    // The surviving backends are untouched by the sweep.
    expect(Object.keys(backends).sort()).toEqual(
      ['drawthings', 'flux', 'grok', 'nanobanana', 'openai']
    )
  })

  it('drops the pre-closed-list Gemini text models array', async () => {
    const loaded = await loadWritten({ text_ai: { gemini: { models: ['gemini-1.0'], main_model: 'kept' } } })
    const gemini = (loaded.text_ai as unknown as Record<string, Record<string, unknown>>).gemini
    expect(gemini).not.toHaveProperty('models')
    // A legacy tier selection survives — the store never judges a selection.
    expect(gemini.main_model).toBe('kept')
  })

  it('drops the notification volume, which moved to state.json', async () => {
    const loaded = await loadWritten({
      notifications: { volume: 0.9, sounds_enabled: false },
    })
    const notifications = loaded.notifications as unknown as Record<string, unknown>
    expect(notifications).not.toHaveProperty('volume')
    // The neighbouring toggle is a real setting and stays.
    expect(notifications.sounds_enabled).toBe(false)
  })

  it('strips a stale api_key an older build left on disk, value and all', async () => {
    const loaded = await loadWritten({
      text_ai: { gemini: { api_key: 'sk-stale-secret' } },
      image_backends: { grok: { api_key: 'xai-stale-secret', model: 'kept' } },
    })
    const gemini = (loaded.text_ai as unknown as Record<string, Record<string, unknown>>).gemini
    const grok = (loaded.image_backends as unknown as Record<string, Record<string, unknown>>).grok
    expect(gemini).not.toHaveProperty('api_key')
    expect(grok).not.toHaveProperty('api_key')
    expect(grok.model).toBe('kept')
  })
})
