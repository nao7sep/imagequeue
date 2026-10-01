import { describe, expect, it } from 'vitest'
import { AI_ROLES, SUPPORTED_MODELS, TEXT_PROVIDERS, defaultModelFor, modelsFor } from '../../src/shared/ai-models'
import { ThinkingLevel } from '@google/genai'
import { configSetDefaults } from '../../src/main/config/config-sets'
import { geminiTextParams, openaiTextParams } from '../../src/main/text-ai/request'
import { modelPickerGroups } from '../../src/shared/model-lists'

describe('text routing guard', () => {
  it('gives every text row its own branch', () => {
    for (const row of SUPPORTED_MODELS) {
      const params = row.provider === 'gemini' ? geminiTextParams(row.id) : openaiTextParams(row.id)
      expect(params, row.id).toEqual(row.provider === 'gemini'
        ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM } }
        : { reasoning_effort: 'medium' })
    }
  })
  it('matches a row on the trimmed, lower-cased id', () => {
    expect(geminiTextParams(' GEMINI-3.8-FLASH ')).toEqual({ thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM } })
    expect(openaiTextParams(' GPT-6-LUNA ')).toEqual({ reasoning_effort: 'medium' })
  })
  it('sends an id with no row nothing model-specific but keeps the feature\'s JSON format', () => {
    const schema = { type: 'object' }
    expect(geminiTextParams('nonsense-id')).toEqual({})
    expect(geminiTextParams('nonsense-id', schema)).toEqual({ responseMimeType: 'application/json', responseSchema: schema })
    expect(openaiTextParams('nonsense-id')).toEqual({})
    expect(openaiTextParams('nonsense-id', schema)).toEqual({ response_format: { type: 'json_object' } })
  })
  it('sends no output ceiling and no temperature', () => {
    for (const id of [...SUPPORTED_MODELS.map((row) => row.id), 'nonsense-id']) {
      for (const params of [geminiTextParams(id, {}), openaiTextParams(id, {})]) {
        for (const key of ['maxOutputTokens', 'max_completion_tokens', 'max_tokens', 'temperature']) expect(params, id).not.toHaveProperty(key)
      }
    }
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
  it('keeps distinct groups in preference order without validating typed ids', () => {
    expect(modelPickerGroups('gemini', 'text-balanced', ['gemini-3.8-flash', 'gemini-future'], ['gemini-future', 'custom'])).toEqual({
      bundled: ['gemini-3.8-flash'], fetched: ['gemini-future'], extras: ['custom'],
    })
  })
})
