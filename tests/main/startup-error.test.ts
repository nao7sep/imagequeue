import { describe, expect, it } from 'vitest'
import { startupFailureMessage } from '../../src/main/startup-error'

describe('startupFailureMessage', () => {
  it('keeps the original failure and gives guidance that is true for non-file failures', () => {
    const message = startupFailureMessage(new Error('Window creation failed'))

    expect(message).toContain('Window creation failed')
    expect(message).toContain('stopped before opening its window')
    expect(message).not.toContain('file has been left')
    expect(message).not.toContain('Fix or remove it')
  })

  it('stringifies non-Error failures', () => {
    expect(startupFailureMessage('startup failed')).toContain('startup failed')
  })
})
