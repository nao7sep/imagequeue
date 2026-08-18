import { describe, expect, it } from 'vitest'
import { cleanDisplay, normalizeKey } from '../../../src/main/concepts/normalize'

describe('normalizeKey', () => {
  it('folds case, whitespace runs, and Unicode compatibility forms', () => {
    expect(normalizeKey('Arabian  Night\nMarket')).toBe('arabian night market')
    expect(normalizeKey('ｓａｉｌｏｒ')).toBe('sailor')
    expect(normalizeKey('a　cat')).toBe('a cat') // U+3000 collapses like any whitespace
  })

  it('strips trailing punctuation but keeps interior punctuation', () => {
    expect(normalizeKey('lighthouse keeper.')).toBe('lighthouse keeper')
    expect(normalizeKey("fisherman's wharf,")).toBe("fisherman's wharf")
  })

  it('normalizes wordless text to the empty key', () => {
    expect(normalizeKey('  ...  ')).toBe('')
  })
})

describe('cleanDisplay', () => {
  it('tidies whitespace but keeps casing and trailing words intact', () => {
    expect(cleanDisplay('  Arabian  Night Market ')).toBe('Arabian Night Market')
  })
})
