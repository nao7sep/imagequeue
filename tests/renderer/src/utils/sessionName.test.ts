import { describe, expect, it } from 'vitest'
import { sessionDisplayName, sessionStartTime } from '../../../../src/renderer/src/utils/sessionName'

describe('sessionDisplayName', () => {
  // A session id is a UTC time; on screen it is that moment in the display zone.
  const tokyo = (time: Date): string =>
    new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Tokyo' }).format(time)

  it('shows a session by its start in the display zone, whether named to the second or to the millisecond', () => {
    expect(sessionDisplayName('20260919-091256-utc', tokyo)).toBe('19/09/2026, 18:12:56')
    expect(sessionDisplayName('20260919-091256-888-utc', tokyo)).toBe('19/09/2026, 18:12:56')
    expect(sessionStartTime('20260919-091256-888-utc')?.toISOString()).toBe('2026-09-19T09:12:56.888Z')
  })

  it('leaves a name of any other shape as it is', () => {
    expect(sessionDisplayName('20260919-091256', tokyo)).toBe('20260919-091256')
    expect(sessionDisplayName('20260919-091256-888', tokyo)).toBe('20260919-091256-888')
    expect(sessionDisplayName('imported-session', tokyo)).toBe('imported-session')
    expect(sessionDisplayName('20261399-999999-utc', tokyo)).toBe('20261399-999999-utc')
  })
})
