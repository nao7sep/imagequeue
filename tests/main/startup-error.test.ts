import { describe, expect, it } from 'vitest'
import { startupFailureMessage } from '../../src/main/startup-error'

describe('startupFailureMessage', () => {
  it('keeps hostile startup diagnostics out of the user-facing dialog', () => {
    const hostile = 'EACCES Error invoking remote method IPC /private/tmp/hostile-sentinel'
    const message = startupFailureMessage(new Error(hostile))

    expect(message).toContain('stopped before opening its main window')
    expect(message).not.toContain(hostile)
    expect(message).not.toContain('EACCES')
  })

  it('uses the same stable fallback for non-Error failures', () => {
    expect(startupFailureMessage('hostile sentinel')).not.toContain('hostile sentinel')
  })
})
