import { describe, expect, it } from 'vitest'
import { AI_ROLES, SUPPORTED_MODELS, TEXT_PROVIDERS, defaultModelFor, defaultThinkingFor, hasThinkingChoice, modelsFor, textRowFor, thinkingFor } from '../../src/shared/ai-models'
import { ThinkingLevel } from '@google/genai'
import { configSetDefaults } from '../../src/main/config/config-sets'
import { geminiTextParams, openaiTextParams } from '../../src/main/text-ai/request'

describe('text routing guard', () => {
  it('translates every thinking value each text row lists through its own branch', () => {
    for (const row of SUPPORTED_MODELS) {
      expect(row.thinking.length, row.id).toBeGreaterThan(0)
      for (const value of row.thinking) {
        if (row.provider === 'gemini') {
          expect(geminiTextParams(row.id, value), `${row.id}/${value}`).toEqual({ thinkingConfig: { thinkingLevel: value.toUpperCase() } })
          expect(Object.values(ThinkingLevel)).toContain(value.toUpperCase())
        } else {
          expect(openaiTextParams(row.id, value), `${row.id}/${value}`).toEqual({ reasoning_effort: value })
        }
      }
    }
  })
  it('matches a row on the trimmed, lower-cased id', () => {
    expect(geminiTextParams(' GEMINI-3.8-FLASH ', 'high')).toEqual({ thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } })
    expect(openaiTextParams(' GPT-6-LUNA ', 'none')).toEqual({ reasoning_effort: 'none' })
    expect(textRowFor('openai', ' GPT-6-LUNA ')?.id).toBe('gpt-6-luna')
  })
  it('sends an id with no row nothing model-specific, no thinking, but keeps the feature\'s JSON format', () => {
    const schema = { type: 'object' }
    expect(geminiTextParams('nonsense-id', 'high')).toEqual({})
    expect(geminiTextParams('nonsense-id', 'high', schema)).toEqual({ responseMimeType: 'application/json', responseSchema: schema })
    expect(openaiTextParams('nonsense-id', 'high')).toEqual({})
    expect(openaiTextParams('nonsense-id', 'high', schema)).toEqual({ response_format: { type: 'json_object' } })
  })
  it('defaults thinking by tier', () => {
    const row = (id: string) => SUPPORTED_MODELS.find((each) => each.id === id)!
    for (const each of SUPPORTED_MODELS) expect(defaultThinkingFor(each, 'text-balanced'), each.id).toBe('medium')
    expect(defaultThinkingFor(row('gpt-6-luna'), 'text-fast')).toBe('none')
    expect(defaultThinkingFor(row('gpt-5.6-terra'), 'text-fast')).toBe('none')
    expect(defaultThinkingFor(row('gemini-3.5-flash-lite'), 'text-fast')).toBe('minimal')
    expect(defaultThinkingFor(row('gemini-3.8-flash'), 'text-fast')).toBe('low')
    const adaptive = { ...row('gpt-6-luna'), thinking: ['off', 'low', 'adaptive'] }
    expect(defaultThinkingFor(adaptive, 'text-fast')).toBe('off')
    expect(defaultThinkingFor(adaptive, 'text-smart')).toBe('adaptive')
  })
  it('sends the role\'s default for a chosen value the row does not list', () => {
    const luna = SUPPORTED_MODELS.find((each) => each.id === 'gpt-6-luna')!
    expect(thinkingFor(luna, 'text-fast', 'high')).toBe('high')
    expect(thinkingFor(luna, 'text-fast', 'minimal')).toBe('none')
    expect(thinkingFor(luna, 'text-fast', '')).toBe('none')
  })
  it('offers a Thinking choice only for a row with more than one value', () => {
    const luna = SUPPORTED_MODELS.find((each) => each.id === 'gpt-6-luna')!
    expect(hasThinkingChoice(luna)).toBe(true)
    expect(hasThinkingChoice({ ...luna, thinking: ['none'] })).toBe(false)
    expect(hasThinkingChoice(undefined)).toBe(false)
  })
  it('sends no output ceiling and no temperature', () => {
    for (const row of [...SUPPORTED_MODELS, { id: 'nonsense-id', thinking: ['medium'] }]) {
      for (const params of [geminiTextParams(row.id, row.thinking[0], {}), openaiTextParams(row.id, row.thinking[0], {})]) {
        for (const key of ['maxOutputTokens', 'max_completion_tokens', 'max_tokens', 'temperature']) expect(params, row.id).not.toHaveProperty(key)
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
})
