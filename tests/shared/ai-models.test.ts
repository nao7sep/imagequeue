import { describe, expect, it } from 'vitest'
import { AI_ROLES, MODEL_LINEUP, SUPPORTED_MODELS, TEXT_PROVIDERS, defaultModelFor, hasThinkingChoice, isTextModel, modelsFor, textRowFor, thinkingFor } from '../../src/shared/ai-models'
import { ThinkingLevel } from '@google/genai'
import { configSetDefaults } from '../../src/main/config/config-sets'
import { GEMINI_SAFETY_SETTINGS, geminiTextParams, openaiTextParams } from '../../src/main/text-ai/request'

const safety = { safetySettings: GEMINI_SAFETY_SETTINGS }
const TEXT_MODELS = SUPPORTED_MODELS.filter(isTextModel)

describe('text routing guard', () => {
  it('rests on the 2026-10-04 lineup', () => {
    expect(MODEL_LINEUP).toBe('ai-model-lineup-20261004')
  })
  it('pins every text row, its order, its thinking list and its default', () => {
    expect(TEXT_MODELS.map(({ provider, id, kinds, defaultFor, thinking, defaultThinking }) =>
      [provider, id, kinds, defaultFor, thinking, defaultThinking])).toEqual([
      ['gemini', 'gemini-3.1-pro-preview', ['text-smart'], ['text-smart'], ['low', 'medium', 'high'], 'medium'],
      ['gemini', 'gemini-3.8-flash', ['text-balanced'], ['text-balanced'], ['low', 'medium', 'high'], 'medium'],
      ['gemini', 'gemini-3.5-flash-lite', ['text-fast'], ['text-fast'], ['minimal', 'low', 'medium', 'high'], 'minimal'],
      ['openai', 'gpt-6-astra', ['text-frontier'], [], ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['openai', 'gpt-6.1-sol', ['text-smart'], ['text-smart'], ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['openai', 'gpt-5.6-terra', ['text-balanced'], ['text-balanced'], ['none', 'low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['openai', 'gpt-6-luna', ['text-fast'], ['text-fast'], ['none', 'low', 'medium', 'high', 'xhigh', 'max'], 'none'],
    ])
    for (const row of TEXT_MODELS) expect(row.thinking, row.id).toContain(row.defaultThinking)
  })
  it('pins each role\'s default model', () => {
    expect([defaultModelFor('gemini', 'text-balanced'), defaultModelFor('gemini', 'text-fast')]).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite'])
    expect([defaultModelFor('openai', 'text-balanced'), defaultModelFor('openai', 'text-fast')]).toEqual(['gpt-5.6-terra', 'gpt-6-luna'])
  })
  it('translates every thinking value each text row lists through its own branch', () => {
    for (const row of TEXT_MODELS) {
      expect(row.thinking.length, row.id).toBeGreaterThan(0)
      for (const value of row.thinking) {
        if (row.provider === 'gemini') {
          expect(geminiTextParams(row.id, value), `${row.id}/${value}`).toEqual({ ...safety, thinkingConfig: { thinkingLevel: value.toUpperCase() } })
          expect(Object.values(ThinkingLevel)).toContain(value.toUpperCase())
        } else {
          expect(openaiTextParams(row.id, value), `${row.id}/${value}`).toEqual({ reasoning_effort: value })
        }
      }
    }
  })
  it('matches a row on the trimmed, lower-cased id', () => {
    expect(geminiTextParams(' GEMINI-3.8-FLASH ', 'high')).toEqual({ ...safety, thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } })
    expect(openaiTextParams(' GPT-6-LUNA ', 'none')).toEqual({ reasoning_effort: 'none' })
    expect(textRowFor('openai', ' GPT-6-LUNA ')?.id).toBe('gpt-6-luna')
  })
  it('sends an id with no row nothing model-specific, no thinking, but keeps the feature\'s strict schema and the safety settings', () => {
    const schema = { type: 'object' }
    expect(geminiTextParams('nonsense-id', 'high')).toEqual(safety)
    expect(geminiTextParams('nonsense-id', 'high', schema)).toEqual({ ...safety, responseMimeType: 'application/json', responseJsonSchema: schema })
    expect(openaiTextParams('nonsense-id', 'high')).toEqual({})
    expect(openaiTextParams('nonsense-id', 'high', schema)).toEqual({ response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema } } })
  })
  it('treats a removed text id as an id with no row', () => {
    for (const id of ['gpt-6-sol', 'gemini-2.5-flash', 'gpt-5.6-sol', 'gpt-5.6-luna']) {
      expect(textRowFor('openai', id) ?? textRowFor('gemini', id), id).toBeUndefined()
      expect(openaiTextParams(id, 'high')).toEqual({})
      expect(geminiTextParams(id, 'high')).toEqual(safety)
    }
  })
  it('sends every current harm category off, and not civic integrity', () => {
    expect(GEMINI_SAFETY_SETTINGS).toEqual([
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_JAILBREAK', threshold: 'OFF' },
    ])
  })
  it('sends the row\'s default for a chosen value the row does not list', () => {
    const luna = TEXT_MODELS.find((each) => each.id === 'gpt-6-luna')!
    expect(thinkingFor(luna, 'high')).toBe('high')
    expect(thinkingFor(luna, 'minimal')).toBe('none')
    expect(thinkingFor(luna, '')).toBe('none')
    // The model's tier sets the default, whatever role it serves.
    const flash = TEXT_MODELS.find((each) => each.id === 'gemini-3.8-flash')!
    expect(thinkingFor(flash, '')).toBe('medium')
  })
  it('offers a Thinking choice only for a row with more than one value', () => {
    const luna = TEXT_MODELS.find((each) => each.id === 'gpt-6-luna')!
    expect(hasThinkingChoice(luna)).toBe(true)
    expect(hasThinkingChoice({ ...luna, thinking: ['none'] })).toBe(false)
    expect(hasThinkingChoice(undefined)).toBe(false)
  })
  it('sends no output ceiling and no temperature', () => {
    for (const row of [...TEXT_MODELS, { id: 'nonsense-id', thinking: ['medium'] }]) {
      for (const params of [geminiTextParams(row.id, row.thinking[0], {}), openaiTextParams(row.id, row.thinking[0], {})]) {
        for (const key of ['maxOutputTokens', 'max_completion_tokens', 'max_tokens', 'temperature']) expect(params, row.id).not.toHaveProperty(key)
      }
    }
  })
  it('has one default per offered kind, a model for every role, and a setting per role', () => {
    const sets = configSetDefaults()
    for (const provider of TEXT_PROVIDERS) {
      const kinds = new Set(TEXT_MODELS.filter((row) => row.provider === provider).flatMap((row) => row.kinds))
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
