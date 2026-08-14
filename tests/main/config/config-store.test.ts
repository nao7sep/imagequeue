import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deepMergeDefaults } from '../../../src/main/config/config-store'

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
})
