import { describe, expect, it } from 'vitest'
import { extractJson } from '../../../src/main/text-ai/json'

describe('extractJson', () => {
  it('parses a clean JSON object directly', () => {
    expect(extractJson('{"prompts":["a","b"]}')).toEqual({ prompts: ['a', 'b'] })
  })

  it('parses a clean JSON array directly', () => {
    expect(extractJson('[1, 2, 3]')).toEqual([1, 2, 3])
  })

  it('tolerates surrounding whitespace', () => {
    expect(extractJson('  \n {"ok":true} \n ')).toEqual({ ok: true })
  })

  it('strips a ```json fence', () => {
    const text = '```json\n{"prompts":["x"]}\n```'
    expect(extractJson(text)).toEqual({ prompts: ['x'] })
  })

  it('strips a bare ``` fence', () => {
    const text = '```\n{"n":1}\n```'
    expect(extractJson(text)).toEqual({ n: 1 })
  })

  it('extracts JSON wrapped in prose', () => {
    const text = 'Sure! Here you go:\n{"prompts":["a"]}\nHope that helps.'
    expect(extractJson(text)).toEqual({ prompts: ['a'] })
  })

  it('extracts the full nested object, not a truncated inner one', () => {
    const text = 'result: {"outer":{"inner":[1,2]},"k":"v"} done'
    expect(extractJson(text)).toEqual({ outer: { inner: [1, 2] }, k: 'v' })
  })

  it('returns undefined for empty or whitespace-only input', () => {
    expect(extractJson('')).toBeUndefined()
    expect(extractJson('   \n\t ')).toBeUndefined()
  })

  it('returns undefined when there is no JSON at all', () => {
    expect(extractJson('I could not generate a response.')).toBeUndefined()
  })
})
