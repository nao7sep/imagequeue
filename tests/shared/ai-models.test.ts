import { describe, expect, it } from 'vitest'
import { AI_ROLES, SUPPORTED_MODELS, TEXT_PROVIDERS, defaultModelFor, hasThinkingChoice, isTextModel, modelsFor, textRowFor, thinkingFor } from '../../src/shared/ai-models'
import { HarmCategory, ThinkingLevel } from '@google/genai'
import { configSetDefaults } from '../../src/main/config/config-sets'
import { GEMINI_SAFETY_SETTINGS, geminiTextParams, openaiTextParams } from '../../src/main/text-ai/request'

const safety = { safetySettings: GEMINI_SAFETY_SETTINGS }
const TEXT_MODELS = SUPPORTED_MODELS.filter(isTextModel)

const NO_THINKING = ['none', 'off', 'between_tools']

type TierRow = { id: string; kinds: readonly string[]; defaultFor: readonly string[]; thinking?: readonly string[]; defaultThinking?: string }

// What a row's tier allows it to default to (ai-model-routing-conventions): a
// row is a default only for kinds it serves, a frontier row is never a
// default, and its default thinking follows its tier. A fast row defaults to
// its no-thinking value, else its lowest, and any other row to `adaptive`,
// else `medium`; a row with neither has its default decided by the lineup
// research. Returns the rows that break this, so a planted table shows it is
// found.
function tierViolations(rows: readonly TierRow[]): string[] {
  return rows.flatMap((row) => {
    const found: string[] = []
    for (const kind of row.defaultFor) if (!row.kinds.includes(kind)) found.push(`${row.id} defaults for ${kind}, which it does not serve`)
    if (row.kinds.includes('text-frontier') && row.defaultFor.length > 0) found.push(`${row.id} is a frontier default`)
    const { thinking, defaultThinking } = row
    if (thinking && defaultThinking !== undefined) {
      const quiet = thinking.findIndex((value) => NO_THINKING.includes(value))
      if (quiet > 0) found.push(`${row.id} lists ${thinking[quiet]} after other values`)
      const expected = row.kinds.includes('text-fast')
        ? thinking[0]
        : ['adaptive', 'medium'].find((value) => thinking.includes(value)) ?? defaultThinking
      if (defaultThinking !== expected) found.push(`${row.id} defaults to ${defaultThinking} thinking, not ${expected}`)
    }
    return found
  })
}

describe('text routing guard', () => {
  it('gives every row only the defaults its tier allows', () => {
    expect(tierViolations(SUPPORTED_MODELS)).toEqual([])
  })
  it('finds a row whose defaults its tier does not allow', () => {
    const planted: TierRow[] = [
      { id: 'frontier', kinds: ['text-frontier'], defaultFor: ['text-frontier'] },
      { id: 'stray', kinds: ['text-smart'], defaultFor: ['text-balanced'] },
      { id: 'fast', kinds: ['text-fast'], defaultFor: [], thinking: ['none', 'low', 'medium'], defaultThinking: 'medium' },
      { id: 'smart', kinds: ['text-smart'], defaultFor: [], thinking: ['adaptive', 'low', 'medium'], defaultThinking: 'medium' },
      { id: 'late', kinds: ['text-smart'], defaultFor: [], thinking: ['low', 'none', 'medium'], defaultThinking: 'medium' },
    ]
    expect(tierViolations(planted)).toEqual([
      'frontier is a frontier default',
      'stray defaults for text-balanced, which it does not serve',
      'fast defaults to medium thinking, not none',
      'smart defaults to medium thinking, not adaptive',
      'late lists none after other values',
    ])
  })
  it('lists each text row\'s default thinking among its values', () => {
    for (const row of TEXT_MODELS) expect(row.thinking, row.id).toContain(row.defaultThinking)
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
    for (const row of TEXT_MODELS) {
      const typed = ` ${row.id.toUpperCase()} `
      const value = row.thinking.at(-1)!
      const params = row.provider === 'gemini' ? geminiTextParams : openaiTextParams
      expect(params(typed, value), row.id).toEqual(params(row.id, value))
      expect(textRowFor(row.provider, typed)?.id).toBe(row.id)
    }
  })
  it('sends an id with no row nothing model-specific, no thinking or safety, but keeps the feature\'s strict schema', () => {
    const schema = { type: 'object' }
    expect(geminiTextParams('nonsense-id', 'high')).toEqual({})
    expect(geminiTextParams('nonsense-id', 'high', schema)).toEqual({ responseMimeType: 'application/json', responseJsonSchema: schema })
    expect(openaiTextParams('nonsense-id', 'high')).toEqual({})
    expect(openaiTextParams('nonsense-id', 'high', schema)).toEqual({ response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema } } })
  })
  // Every harm category the SDK knows, except the unspecified placeholder,
  // civic integrity and the image-only categories text calls never use.
  it('sends every current harm category off, and not civic integrity', () => {
    const sent = GEMINI_SAFETY_SETTINGS.map((setting) => setting.category)
    expect(GEMINI_SAFETY_SETTINGS.every((setting) => setting.threshold === 'OFF')).toBe(true)
    expect(sent).not.toContain(HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY)
    expect(new Set(sent).size).toBe(sent.length)
    for (const category of sent) expect(Object.values(HarmCategory), category).toContain(category)
    for (const category of Object.values(HarmCategory)) {
      if (category === HarmCategory.HARM_CATEGORY_UNSPECIFIED || category === HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY || category.startsWith('HARM_CATEGORY_IMAGE_')) continue
      expect(sent, category).toContain(category)
    }
  })
  it('sends the row\'s default for a chosen value the row does not list', () => {
    for (const row of TEXT_MODELS) {
      for (const value of row.thinking) expect(thinkingFor(row, value), row.id).toBe(value)
      expect(thinkingFor(row, 'not-a-level'), row.id).toBe(row.defaultThinking)
      expect(thinkingFor(row, ''), row.id).toBe(row.defaultThinking)
    }
  })
  it('offers a Thinking choice only for a row with more than one value', () => {
    const row = TEXT_MODELS[0]!
    expect(hasThinkingChoice({ ...row, thinking: ['low', 'high'] })).toBe(true)
    expect(hasThinkingChoice({ ...row, thinking: ['none'] })).toBe(false)
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
