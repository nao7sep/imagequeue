import { describe, expect, it } from 'vitest'
import {
  singleLine,
  multiline,
  truncate,
  PROMPT_PREVIEW_MIN_GRAPHEMES,
} from '../../../../src/renderer/src/utils/textCleanup'

// These mirror the test-proven cases from the convention's reference
// verification, plus the specific shapes this app actually relies on:
// single-line for names/directives/negative prompts, multiline for prompt and
// template bodies, and multiline-truncation for the one-line preview surfaces.

describe('singleLine', () => {
  it('trims the ends', () => {
    expect(singleLine('  hello  ')).toBe('hello')
  })

  it('flattens a line break run into one space by default', () => {
    expect(singleLine('a\nb')).toBe('a b')
    expect(singleLine('aaa\n \n\nbbb')).toBe('aaa bbb')
  })

  it('preserves interior horizontal spacing by default', () => {
    expect(singleLine('a    b')).toBe('a    b')
  })

  it('keeps a lone full-width space when no line break is present (default)', () => {
    expect(singleLine('a　b')).toBe('a　b')
  })

  it('collapses every run including a lone full-width space when minifying', () => {
    expect(singleLine('a    b', { minify: true })).toBe('a b')
    expect(singleLine('a　　b', { minify: true })).toBe('a b')
  })

  it('keeps line breaks when flattenLineBreaks is off', () => {
    expect(singleLine('  a\nb  ', { flattenLineBreaks: false })).toBe('a\nb')
  })

  it('reduces an all-whitespace value (including U+3000) to empty', () => {
    expect(singleLine('\n\n  \n')).toBe('')
    expect(singleLine('　　')).toBe('')
  })
})

describe('multiline', () => {
  it('drops edge blank lines and trailing whitespace while keeping indentation', () => {
    expect(multiline('\n\n  hello  \n\n')).toBe('  hello')
  })

  it('trims each line end by default', () => {
    expect(multiline('a  \nb  ')).toBe('a\nb')
  })

  it('keeps trailing whitespace when trimLineEnds is off (markdown hard breaks)', () => {
    expect(multiline('a  \nb  ', { trimLineEnds: false })).toBe('a  \nb  ')
  })

  it('preserves interior blank runs by default, collapses them on request', () => {
    expect(multiline('a\n\n\nb')).toBe('a\n\n\nb')
    expect(multiline('a\n\n\nb', { collapseBlankLines: true })).toBe('a\n\nb')
  })

  it('normalizes CRLF and lone CR to LF', () => {
    expect(multiline('a\r\nb\r\nc')).toBe('a\nb\nc')
    expect(multiline('a\rb')).toBe('a\nb')
  })

  it('treats a whitespace-only line as blank', () => {
    expect(multiline('a\n   \nb')).toBe('a\n\nb')
    expect(multiline('   \n   ')).toBe('')
  })

  it('preserves interior indentation', () => {
    expect(multiline('  indented\n    more')).toBe('  indented\n    more')
  })
})

describe('truncate', () => {
  it('cuts at the minimum length and reports truncated', () => {
    expect(truncate('hello world', 5)).toEqual({ text: 'hello', truncated: true })
  })

  it('does not report a cut at exact or under budget', () => {
    expect(truncate('hello', 5)).toEqual({ text: 'hello', truncated: false })
    expect(truncate('hello', 10)).toEqual({ text: 'hello', truncated: false })
  })

  it('skips leading whitespace and never reports a cut for an all-whitespace tail', () => {
    expect(truncate('  hello  ', 3)).toEqual({ text: 'hel', truncated: true })
    // Trailing whitespace past the budget is not a visible grapheme: honesty.
    expect(truncate('hello   ', 5)).toEqual({ text: 'hello', truncated: false })
    expect(truncate('   ', 5)).toEqual({ text: '', truncated: false })
  })

  it('flattens a multiline body into a single line', () => {
    expect(truncate('a\nb\nc', 1)).toEqual({ text: 'a', truncated: true })
    expect(truncate('one\ntwo\nthree', 7)).toEqual({ text: 'one two', truncated: true })
  })

  it('counts inserted spaces toward the budget', () => {
    expect(truncate('one two three', 5)).toEqual({ text: 'one t', truncated: true })
  })

  it('never splits a multi-codepoint grapheme', () => {
    // Surrogate-pair emoji.
    expect(truncate('\u{1F600}x', 1)).toEqual({ text: '\u{1F600}', truncated: true })
    // ZWJ family emoji stays whole — ZWJ is structural, not whitespace.
    expect(truncate('\u{1F468}‍\u{1F469}‍\u{1F467}x', 1)).toEqual({
      text: '\u{1F468}‍\u{1F469}‍\u{1F467}',
      truncated: true,
    })
    // Combining mark stays with its base.
    expect(truncate('éllo', 2)).toEqual({ text: 'él', truncated: true })
  })

  it('guards empty input and n <= 0', () => {
    expect(truncate('', 5)).toEqual({ text: '', truncated: false })
    expect(truncate('hello', 0)).toEqual({ text: '', truncated: false })
  })

  it('exposes a generous preview budget well above what a one-line pane shows', () => {
    expect(PROMPT_PREVIEW_MIN_GRAPHEMES).toBeGreaterThanOrEqual(100)
    // A long multiline prompt under the budget is flattened whole, not cut.
    const body = 'line one\nline two\nline three'
    const result = truncate(body, PROMPT_PREVIEW_MIN_GRAPHEMES)
    expect(result.text).toBe('line one line two line three')
    expect(result.truncated).toBe(false)
  })
})
