import { describe, expect, it } from 'vitest'
import {
  cliJobStartFailurePresentation,
  configResetPresentation,
  elaboratorRecoveryPresentation,
  generationFailurePresentation,
  newerFilePresentation,
  modelParamsResetPresentation,
  storeLeftInPlacePresentation,
  startupFailurePresentation,
} from '../../src/main/failure-presentation'
import { ConfigFileHaltError } from '../../src/main/config/config-store'
import { NewerFormatError } from '../../src/main/store-format'
import { ProviderHttpError, ProviderStatusError } from '../../src/main/provider-errors'
import { loadTranslator } from '../../src/shared/i18n/translate'

// Presentations are messages; these read them as English would show them.
const { text } = await loadTranslator('en')
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

  it('points an unclassified failure to the Records window', () => {
    expect(presented('openai', new Error(hostile), false)).toContain('Records in the main menu')
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

  it('uses an app-wide notice only for successful elaborator recovery, naming the preserved file', () => {
    const preserved = '/data/elaborators-20261002T000000Z.invalid'
    const notice = elaboratorRecoveryPresentation({ kind: 'recovered', path: preserved })
    expect(notice && text(notice.title)).toBe('Elaborators were reset')
    expect(notice && text(notice.message)).toContain(`elaborators file was unreadable, so ImageQueue set it aside at ${preserved}`)
    expect(elaboratorRecoveryPresentation({ kind: 'quarantine-failed', path: preserved, error: hostile })).toBeNull()
  })

  it('names the set-aside settings file when settings are reset', () => {
    const preserved = '/data/config-20261002T000000Z.invalid'
    const notice = configResetPresentation(preserved)
    expect(text(notice.title)).toBe('Settings were reset')
    expect(text(notice.message)).toContain(preserved)
  })

  it('names the settings file and its path when it stopped startup, and keeps other diagnostics out', () => {
    const settings = '/Users/me/.imagequeue/config.json'
    const halted = text(startupFailurePresentation(new ConfigFileHaltError(settings, { cause: new Error(hostile) })))
    expect(halted).toContain(`settings file at ${settings}`)
    expect(halted).toContain('left it unchanged')
    expect(halted).not.toContain('hostile-sentinel')

    const other = text(startupFailurePresentation(new Error(hostile)))
    expect(other).toContain('stopped before opening its main window')
    expect(other).not.toContain('hostile-sentinel')
  })

  it('names a file a newer version wrote, when it stopped startup and when a request needed it', () => {
    const settings = '/Users/me/.imagequeue/config.json'
    const halted = text(startupFailurePresentation(new NewerFormatError(settings, 2, 1)))
    expect(halted).toContain(`newer version of ImageQueue wrote the file at ${settings}`)
    expect(halted).toContain('left it unchanged')

    const elaborators = '/Users/me/.imagequeue/elaborators.json'
    const notice = newerFilePresentation(elaborators)
    expect(text(notice.title)).toBe('File from a newer version')
    expect(text(notice.message)).toContain(`newer version of ImageQueue wrote the file at ${elaborators}`)
  })

  it('names the set-aside copy of unreadable Draw Things parameters, and a file left in place', () => {
    const setAside = '/Users/me/.imagequeue/params-20261006-031340-123-utc.invalid'
    const reset = modelParamsResetPresentation(setAside)
    expect(text(reset.title)).toBe('Draw Things parameters were reset')
    expect(text(reset.message)).toContain(`set the file aside at ${setAside}`)

    const params = '/Users/me/.imagequeue/params.json'
    const left = storeLeftInPlacePresentation(params)
    expect(text(left.title)).toBe('File left unchanged')
    expect(text(left.message)).toContain(`the file at ${params}`)
    expect(text(left.message)).toContain('left it unchanged')
  })

  it('keeps spawn diagnostics out of the visible managed-tool terminal', () => {
    const error = new Error(hostile, { cause: new Error('root cause') })
    const download = cliJobStartFailurePresentation('download', error)
    const imported = cliJobStartFailurePresentation('import', error)

    expect(download).toContain('download could not be started')
    expect(imported).toContain('import could not be started')
    expect(download).toContain('Records in the main menu')
    expect(imported).toContain('Records in the main menu')
    expect(download).not.toContain(hostile)
    expect(imported).not.toContain(hostile)
    expect(error.cause).toBeInstanceOf(Error)
  })
})
