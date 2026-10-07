import { describe, expect, it } from 'vitest'
import { isStoredTaskParams } from '../../../src/main/session/stored-task-params'
import type { BackendId } from '../../../src/shared/types'

describe('stored request parameter types', () => {
  it.each([
    ['openai', 'gpt-image-2', { width: 'wide' }],
    ['openai', 'gpt-image-2.5-flare', { background: {} }],
    ['nanobanana', 'gemini-3-pro-image', { thinking: 2 }],
    ['nanobanana', 'gemini-3.1-flash-image', { thinking: 'low', imageSize: {} }],
    ['nanobanana', 'gemini-3.1-flash-lite-image', {}],
    ['flux', 'flux-3-image', { resolution: [] }],
    ['flux', 'flux-2-pro', { seed: 'seed' }],
    ['flux', 'flux-2-flex', { guidance: Number.NaN }],
    ['grok', 'grok-imagine-image', { aspectRatio: {} }],
    ['grok', 'grok-imagine-image-2.0', { quality: 2 }],
    ['drawthings', 'arbitrary', { seed: Infinity }],
    ['drawthings', 'arbitrary', { negativePrompt: {} }],
  ] as const)('rejects %s %s consumed value %j', (backend, model, params) => {
    expect(isStoredTaskParams(backend, model, params)).toBe(false)
  })

  it.each(['openai', 'nanobanana', 'flux', 'grok'] as BackendId[])('leaves unlisted %s model parameters to its plain request', (backend) => {
    expect(isStoredTaskParams(backend, 'unlisted', { thinking: {}, width: 'wide', providerParameter: [] })).toBe(true)
  })

  it('keeps absent/null optional Draw Things parameters and provider-owned choices/ranges', () => {
    expect(isStoredTaskParams('drawthings', 'constructor', { width: null, seed: null, negativePrompt: null })).toBe(true)
    expect(isStoredTaskParams('drawthings', '__proto__', {})).toBe(true)
    expect(isStoredTaskParams('openai', 'gpt-image-2', { width: -100, quality: 'future-choice' })).toBe(true)
    expect(isStoredTaskParams('nanobanana', 'gemini-3-pro-image', { thinking: 'future-level', imageSize: 'future-size' })).toBe(true)
    expect(isStoredTaskParams('flux', 'flux-2-pro', { seed: null })).toBe(true)
  })
})
