import { describe, expect, it } from 'vitest'
import { currentSessionImageUrl, parseImageUrl, sessionImageUrl } from '../../src/shared/image-url'

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
    expect(parseImageUrl('iq-image://output/current/')).toBeNull()
    expect(parseImageUrl('iq-image://output/session/only-id')).toBeNull()
    expect(parseImageUrl('iq-image://output/current/a/b')).toBeNull()
    expect(parseImageUrl('not a url')).toBeNull()
  })
})
