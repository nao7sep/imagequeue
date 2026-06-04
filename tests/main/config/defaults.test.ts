import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../../../src/main/config/defaults'
import { deepMergeDefaults } from '../../../src/main/config/config-store'

describe('createDefaultConfig', () => {
  it('returns a fresh object each call (no shared mutable state)', () => {
    const a = createDefaultConfig()
    const b = createDefaultConfig()
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(a.general).not.toBe(b.general)
  })

  it('is a fixed point of deepMergeDefaults (merging defaults over defaults is a no-op)', () => {
    const defaults = createDefaultConfig()
    expect(deepMergeDefaults(createDefaultConfig(), defaults)).toEqual(defaults)
  })
})
