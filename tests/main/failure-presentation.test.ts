import { describe, expect, it } from 'vitest'
import { elaboratorRecoveryPresentation, generationFailurePresentation } from '../../src/main/failure-presentation'

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

  it('keeps recovery diagnostics and internal paths out of app notices', () => {
    for (const kind of ['recovered', 'quarantine-failed', 'reseed-failed'] as const) {
      const notice = elaboratorRecoveryPresentation({ kind, path: hostile, error: hostile })
      expect(notice.title).not.toContain(hostile)
      expect(notice.message).not.toContain(hostile)
    }
  })
})
