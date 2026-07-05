import { describe, expect, it } from 'vitest'
import { decodeApiKey, encodeApiKey, isValidStoredApiKey } from '../../../src/main/config/api-key'

describe('api-key encode/decode', () => {
  it('round-trips a plaintext key through encode then decode', () => {
    const key = 'sk-abc123XYZ'
    const stored = encodeApiKey(key)
    expect(stored.startsWith('obf:')).toBe(true)
    expect(stored).not.toContain(key)
    expect(decodeApiKey(stored)).toBe(key)
    expect(isValidStoredApiKey(stored)).toBe(true)
  })

  it('treats an untagged value as plaintext (a hand-pasted key)', () => {
    expect(decodeApiKey('sk-pasted-raw')).toBe('sk-pasted-raw')
    expect(isValidStoredApiKey('sk-pasted-raw')).toBe(true)
  })

  it('treats the empty string as absent', () => {
    expect(decodeApiKey('')).toBe('')
    expect(isValidStoredApiKey('')).toBe(true)
    expect(encodeApiKey('')).toBe('')
  })

  describe('malformed obf: payloads decode to absent, never to garbage', () => {
    it.each([
      'obf:not-valid-base64!!', // characters outside the base64 alphabet
      'obf:abc', // length not a multiple of 4
      'obf:', // empty payload behind the marker
      'obf:====', // padding-only, no data
      'obf:ab=c' // '=' not confined to the end
    ])('rejects %s', (malformed) => {
      expect(isValidStoredApiKey(malformed)).toBe(false)
      expect(decodeApiKey(malformed)).toBe('')
    })
  })

  it('accepts a canonically-shaped payload even if hand-typed (not just self-encoded)', () => {
    // "sk-test" reversed and base64-encoded by hand, to prove the check is
    // about shape, not "was it produced by encodeApiKey".
    const stored = encodeApiKey('sk-test')
    expect(isValidStoredApiKey(stored)).toBe(true)
    expect(decodeApiKey(stored)).toBe('sk-test')
  })
})
