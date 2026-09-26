import { describe, expect, it } from 'vitest'
import {
  cliJobStartFailurePresentation,
  elaboratorRecoveryPresentation,
  generationFailurePresentation,
} from '../../src/main/failure-presentation'
import { ProviderHttpError, ProviderStatusError } from '../../src/main/provider-errors'
import { createTranslator } from '../../src/shared/i18n/translate'

// Presentations are messages; these read them as English would show them.
const { text } = createTranslator('en')
const presented = (...args: Parameters<typeof generationFailurePresentation>): string =>
  text(generationFailurePresentation(...args))

const hostile = 'EACCES Error invoking remote method IPC /private/tmp/hostile-sentinel'

describe('generationFailurePresentation', () => {
  it('keeps arbitrary diagnostics out of task presentation', () => {
    const error = new Error(hostile, { cause: new Error('root cause') })
    const message = presented('openai', error, false)

    expect(message).toContain('OpenAI')
    expect(message).not.toContain(hostile)
    expect(error.cause).toBeInstanceOf(Error)
  })

  it('classifies known recovery from structured fields rather than message text', () => {
    expect(presented('grok', new ProviderHttpError('unrelated', 401), false)).toContain('API key')
    expect(presented('flux', new ProviderHttpError('unrelated', 429), false)).toContain('rate-limiting')
    expect(presented('drawthings', { code: 'EACCES', message: hostile }, false)).toContain('file permissions')
  })

  it('names a provider’s own terminal status, reduced to a short plain label', () => {
    expect(presented('flux', new ProviderStatusError('FLUX', 'Request Moderated', hostile), false))
      .toContain('“Request Moderated”')
    const shown = presented('flux', new ProviderStatusError('FLUX', '<b>/private/tmp/x</b>' + 'y'.repeat(80)), false)
    expect(shown).not.toContain('<')
    expect(shown).not.toContain('/private')
    expect(shown).not.toContain('y'.repeat(41))
  })

  it('distinguishes a paid generation whose local save failed', () => {
    const message = presented('nanobanana', new Error(hostile), true)
    expect(message).toContain('image was generated')
    expect(message).not.toContain(hostile)
  })

  it('uses an app-wide notice only for successful elaborator recovery', () => {
    const notice = elaboratorRecoveryPresentation({ kind: 'recovered', path: hostile })
    expect(notice && text(notice.title)).toContain('settings were reset')
    expect(notice && text(notice.message)).not.toContain(hostile)
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
