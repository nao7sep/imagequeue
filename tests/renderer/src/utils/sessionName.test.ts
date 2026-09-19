import { describe, expect, it } from 'vitest'
import { sessionDisplayName } from '../../../../src/renderer/src/utils/sessionName'

describe('sessionDisplayName', () => {
  it('shows a session by its date and time alone', () => {
    expect(sessionDisplayName('20260919-091256-888-utc')).toBe('20260919-091256')
  })

  it('leaves a name of any other shape as it is', () => {
    expect(sessionDisplayName('20260919-091256')).toBe('20260919-091256')
    expect(sessionDisplayName('20260919-091256-888')).toBe('20260919-091256-888')
    expect(sessionDisplayName('imported-session')).toBe('imported-session')
  })
})
