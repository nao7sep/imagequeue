import { describe, expect, it } from 'vitest'
import { createCliOutputMask } from '../../src/main/cli-output-mask'

describe('streamed CLI credential masking', () => {
  it('masks credentials and URL signatures across every chunk boundary while preserving Unicode and CR', () => {
    const input = '日本語 😀\r\nkey=secret-key https://host/a?sig=long\'signature&next=ok other&sig=value#end\r'
    const expected = '日本語 😀\r\nkey=[REDACTED] https://host/a?sig=[REDACTED]&next=ok other&sig=[REDACTED]#end\r'
    for (let split = 0; split <= input.length; split++) {
      const mask = createCliOutputMask(() => ['secret-key'])
      expect(mask.append(input.slice(0, split)) + mask.append(input.slice(split)) + mask.append('', true)).toBe(expected)
    }
  })

  it('waits for the longest overlapping credential and masks a complete shorter key at EOF', () => {
    const mask = createCliOutputMask(() => ['abc', 'abcd'])
    expect(mask.append('abc')).toBe('')
    expect(mask.append('d ')).toBe('[REDACTED] ')
    expect(mask.append('abc')).toBe('')
    expect(mask.append('', true)).toBe('[REDACTED]')
    const incomplete = createCliOutputMask(() => ['abcd'])
    expect(incomplete.append('abc') + incomplete.append('', true)).toBe('abc')
  })

  it('discards arbitrarily long signature values as they arrive without retaining them', () => {
    const mask = createCliOutputMask(() => [])
    expect(mask.append('https://host?sig=')).toBe('https://host?sig=')
    for (let index = 0; index < 200; index++) {
      expect(mask.append('x'.repeat(8192))).toBe(index === 0 ? '[REDACTED]' : '')
    }
    expect(mask.append("'tail&other=kept") + mask.append('', true)).toBe('&other=kept')
  })

  it('preserves surrogate pairs split into separate strings and follows rotated credential knowledge', () => {
    const keys = ['old-key']
    const mask = createCliOutputMask(() => keys)
    expect(mask.append('\uD83D')).toBe('')
    expect(mask.append('\uDE00')).toBe('😀')
    keys.push('new-key')
    expect(mask.append('old-key new-') + mask.append('key') + mask.append('', true)).toBe('[REDACTED] [REDACTED]')
  })
})
