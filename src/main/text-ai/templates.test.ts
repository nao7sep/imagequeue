import { describe, expect, it } from 'vitest'
import { fillTemplate, JSON_FORMAT_LITERAL } from './templates'

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
})
