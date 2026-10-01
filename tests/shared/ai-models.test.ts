import { describe, expect, it } from 'vitest'
import { AI_ROLES, SUPPORTED_MODELS, TEXT_PROVIDERS, defaultModelFor, modelsFor } from '../../src/shared/ai-models'
import { resolveModel, isTextModel } from '../../src/shared/model-registry'
import { configSetDefaults } from '../../src/main/config/config-sets'
import { geminiTextParams, openaiTextParams } from '../../src/main/text-ai/request'
import { modelPickerGroups } from '../../src/shared/model-lists'

describe('text routing guard', () => {
  it('resolves every confirmed row through a non-generic family', () => {
    expect(SUPPORTED_MODELS.map((row) => row.id)).toEqual([
      'gemini-3.1-pro-preview', 'gemini-3.8-flash', 'gemini-3.5-flash-lite',
      'gpt-6-astra', 'gpt-6.1-sol', 'gpt-5.6-terra', 'gpt-6-luna',
    ])
    for (const row of SUPPORTED_MODELS) expect(resolveModel(row.id, row.provider).generic, row.id).toBe(false)
  })
  it('has one default per offered kind, a model for every role, and a setting per role', () => {
    const sets = configSetDefaults()
    for (const provider of TEXT_PROVIDERS) {
      const kinds = new Set(SUPPORTED_MODELS.filter((row) => row.provider === provider).flatMap((row) => row.kinds))
      for (const kind of kinds) {
        const defaults = modelsFor(provider, kind).filter((row) => row.defaultFor.includes(kind))
        expect(defaults).toHaveLength(kind === 'text-frontier' ? 0 : 1)
      }
      for (const role of AI_ROLES) {
        expect(role.kind).not.toBe('text-frontier')
        expect(modelsFor(provider, role.kind).map((row) => row.id)).toContain(defaultModelFor(provider, role.kind))
        expect(sets[`${provider}.${role.id}`]).toBe(defaultModelFor(provider, role.kind))
      }
    }
  })
  it('uses generic families for unknown ids and keeps image ids out of text lists', () => {
    for (const provider of TEXT_PROVIDERS) expect(resolveModel('nonsense-id', provider).generic).toBe(true)
    expect(isTextModel('gemini-3.1-flash-image', 'gemini')).toBe(false)
    expect(isTextModel('gpt-image-2', 'openai')).toBe(false)
    expect(resolveModel('gemini-2.5-pro', 'gemini').id).toBe('gemini.2.5')
    expect(resolveModel('gemini-3.9-future', 'gemini').id).toBe('gemini.3')
  })
  it('emits only parameters each resolved family declares', () => {
    for (const provider of TEXT_PROVIDERS) {
      for (const model of [...SUPPORTED_MODELS.filter((row) => row.provider === provider).map((row) => row.id), 'nonsense-id', 'gemini-2.5-pro']) {
        const family = resolveModel(model, provider)
        for (const role of AI_ROLES) {
          const params = provider === 'gemini' ? geminiTextParams(model, role.id, {}) : openaiTextParams(model, role.id, {})
          const permitted: Record<string, boolean> = {
            maxOutputTokens: !!family.policy.maxOutputTokens,
            thinkingConfig: !!family.policy.thinkingConfig,
            responseMimeType: !!family.policy.structuredOutput,
            responseSchema: !!family.policy.structuredOutput,
            max_completion_tokens: !!family.policy.maxCompletionTokens,
            reasoning_effort: !!family.policy.reasoningEffort,
            response_format: !!family.policy.structuredOutput,
          }
          for (const key of Object.keys(params)) expect(permitted[key], `${provider}/${model}/${key}`).toBe(true)
          expect(params).not.toHaveProperty('temperature')
        }
      }
    }
    expect(geminiTextParams('gemini-3.8-flash', 'elaboration')).toEqual({ maxOutputTokens: 16384, thinkingConfig: { thinkingLevel: 'medium' } })
    expect(geminiTextParams('gemini-2.5-pro', 'slug')).toEqual({ maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: -1 } })
    expect(openaiTextParams('gpt-6-luna', 'slug')).toEqual({ max_completion_tokens: 2048, reasoning_effort: 'medium' })
    expect(openaiTextParams('local-id', 'slug', {})).toEqual({})
  })
  it('keeps distinct groups in preference order without validating typed ids', () => {
    expect(modelPickerGroups('gemini', 'text-balanced', ['gemini-3.8-flash', 'gemini-future'], ['gemini-future', 'custom'])).toEqual({
      bundled: ['gemini-3.8-flash'], fetched: ['gemini-future'], extras: ['custom'],
    })
  })
})
