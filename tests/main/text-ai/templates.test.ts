import { describe, expect, it } from 'vitest'
import { fillTemplate, JSON_FORMAT_LITERAL } from '../../../src/main/text-ai/templates'

describe('fillTemplate', () => {
  it('substitutes provided placeholders', () => {
    expect(fillTemplate('Make {{N}} prompts about {{TOPIC}}.', { N: '3', TOPIC: 'cats' }))
      .toBe('Make 3 prompts about cats.')
  })

  it('always injects the {{JSON}} format literal even with no values', () => {
    expect(fillTemplate('Respond as {{JSON}}.', {}))
      .toBe(`Respond as ${JSON_FORMAT_LITERAL}.`)
  })

  it('replaces every occurrence of a placeholder', () => {
    expect(fillTemplate('{{X}}-{{X}}-{{X}}', { X: 'a' })).toBe('a-a-a')
  })

  it('leaves unknown placeholders untouched', () => {
    expect(fillTemplate('Hello {{NAME}}', {})).toBe('Hello {{NAME}}')
  })

  it('keeps the JSON format literal even if a caller passes a JSON value', () => {
    expect(fillTemplate('{{JSON}}', { JSON: 'hijacked' })).toBe(JSON_FORMAT_LITERAL)
  })

  it.each([
    { SEED: 'Draw {{N}} cats using {{JSON}} and {{ELABORATOR}}.', ELABORATOR: 'Keep {{SEED}} and {{N}} literal.', N: '3' },
    { N: '3', ELABORATOR: 'Keep {{SEED}} and {{N}} literal.', SEED: 'Draw {{N}} cats using {{JSON}} and {{ELABORATOR}}.' },
  ])('keeps inserted seed and elaborator text literal regardless of value order', (values) => {
    expect(fillTemplate('{{SEED}} | {{ELABORATOR}} | {{N}} | {{JSON}} | {{SEED}}', values))
      .toBe(`Draw {{N}} cats using {{JSON}} and {{ELABORATOR}}. | Keep {{SEED}} and {{N}} literal. | 3 | ${JSON_FORMAT_LITERAL} | Draw {{N}} cats using {{JSON}} and {{ELABORATOR}}.`)
  })

  it('preserves dollar replacement sequences in inserted text', () => {
    expect(fillTemplate('Before {{SEED}} after', { SEED: "$$ $& $` $' $1" }))
      .toBe("Before $$ $& $` $' $1 after")
  })

  it('leaves placeholders for inherited object properties untouched', () => {
    expect(fillTemplate('{{toString}} {{constructor}} {{__proto__}}', {}))
      .toBe('{{toString}} {{constructor}} {{__proto__}}')
  })
})
