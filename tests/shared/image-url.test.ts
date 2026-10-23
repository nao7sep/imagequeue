import { describe, expect, it } from 'vitest'
import { currentSessionImageUrl, parseImageUrl, sessionImageUrl, thumbnailUrl } from '../../src/shared/image-url'

describe('image scheme URLs', () => {
  it('round-trips the active session and a listed session', () => {
    expect(parseImageUrl(currentSessionImageUrl('20260101-000000-1-fox'))).toEqual({
      session: 'current', baseName: '20260101-000000-1-fox',
    })
    expect(parseImageUrl(sessionImageUrl('20260101-000000-123-utc', 'a b#c'))).toEqual({
      session: 'other', sessionId: '20260101-000000-123-utc', baseName: 'a b#c',
    })
  })

  it('rejects other schemes, hosts and shapes', () => {
    expect(parseImageUrl('file:///etc/passwd')).toBeNull()
    expect(parseImageUrl('iq-image://elsewhere/current/x')).toBeNull()
    expect(parseImageUrl('iq-image://sessions/current/')).toBeNull()
    expect(parseImageUrl('iq-image://sessions/session/only-id')).toBeNull()
    expect(parseImageUrl('iq-image://sessions/current/a/b')).toBeNull()
    expect(parseImageUrl('not a url')).toBeNull()
  })
})


describe('thumbnail pixel budgets', () => {
  it('requests physical pixels rounded up while preserving the original URL and target', () => {
    const original = currentSessionImageUrl('image one')
    expect(thumbnailUrl(original, 180.25, 2)).toBe(`${original}?thumbnail=361`)
    expect(original).toBe('iq-image://sessions/current/image%20one')
    expect(parseImageUrl(thumbnailUrl(original, 64, 1.5))).toEqual({ session: 'current', baseName: 'image one' })
    expect(thumbnailUrl(sessionImageUrl('session one', 'image'), 64, 2)).toBe('iq-image://sessions/session/session%20one/image?thumbnail=128')
  })
})
