import { describe, expect, it } from 'vitest'
import {
  cliJobStartFailurePresentation,
  elaboratorRecoveryPresentation,
  generationFailurePresentation,
} from '../../src/main/failure-presentation'

const hostile = 'EACCES Error invoking remote method IPC /private/tmp/hostile-sentinel'

describe('generationFailurePresentation', () => {
  it('keeps arbitrary diagnostics out of task presentation', () => {
    const error = new Error(hostile, { cause: new Error('root cause') })
    const message = generationFailurePresentation('openai', error, false)

    expect(message).toContain('OpenAI')
    expect(message).not.toContain(hostile)
    expect(error.cause).toBeInstanceOf(Error)
  })

  it('classifies known recovery from structured fields rather than message text', () => {
    expect(generationFailurePresentation('grok', { status: 401, message: 'unrelated' }, false)).toContain('API key')
    expect(generationFailurePresentation('flux', { statusCode: 429, message: 'unrelated' }, false)).toContain('rate-limiting')
    expect(generationFailurePresentation('drawthings', { code: 'EACCES', message: hostile }, false)).toContain('file permissions')
  })

  it('distinguishes a paid generation whose local save failed', () => {
    const message = generationFailurePresentation('nanobanana', new Error(hostile), true)
    expect(message).toContain('image was generated')
    expect(message).not.toContain(hostile)
  })

  it('uses an app-wide notice only for successful elaborator recovery', () => {
    const notice = elaboratorRecoveryPresentation({ kind: 'recovered', path: hostile })
    expect(notice?.title).toContain('settings were reset')
    expect(notice?.message).not.toContain(hostile)
    expect(elaboratorRecoveryPresentation({ kind: 'quarantine-failed', error: hostile })).toBeNull()
    expect(elaboratorRecoveryPresentation({ kind: 'reseed-failed', error: hostile })).toBeNull()
  })

  it('keeps spawn diagnostics out of the visible managed-tool terminal', () => {
    const error = new Error(hostile, { cause: new Error('root cause') })
    const download = cliJobStartFailurePresentation('download', error)
    const imported = cliJobStartFailurePresentation('import', error)

    expect(download).toContain('download could not be started')
    expect(imported).toContain('import could not be started')
    expect(download).not.toContain(hostile)
    expect(imported).not.toContain(hostile)
    expect(error.cause).toBeInstanceOf(Error)
  })
})
