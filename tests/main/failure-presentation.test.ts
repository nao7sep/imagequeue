import { describe, expect, it } from 'vitest'
import {
  cliJobStartFailurePresentation,
  backupsOffPresentation,
  generationFailurePresentation,
  newerFilePresentation,
  recordsOffPresentation,
  unreadableFilePresentation,
  startupFailurePresentation,
} from '../../src/main/failure-presentation'
import { LaunchStopError } from '../../src/main/store-format'
import { ProviderHttpError, ProviderStatusError } from '../../src/main/provider-errors'
import { loadTranslator } from '../../src/shared/i18n/translate'
import { DrawThingsOutOfMemoryError } from '../../src/main/provider-errors'

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

  it('tells the user what to change when Draw Things runs out of memory', () => {
    expect(presented('drawthings', new DrawThingsOutOfMemoryError(3840, 2176, 'killed by SIGKILL'), false))
      .toBe('Draw Things ran out of memory at 3840×2176. Try a smaller size or close other apps.')
    expect(presented('drawthings', new DrawThingsOutOfMemoryError(undefined, undefined, 'killed by SIGKILL'), false))
      .toBe('Draw Things ran out of memory. Try a smaller size or close other apps.')
  })

  it('points an unclassified failure to the Records window', () => {
    expect(presented('openai', new Error(hostile), false)).toContain('Records in the main menu')
  })

  it('classifies known recovery from structured fields rather than message text', () => {
    expect(presented('grok', new ProviderHttpError('unrelated', 401), false)).toContain('API key')
    expect(presented('flux', new ProviderHttpError('unrelated', 429), false)).toContain('rate-limiting')
    expect(presented('drawthings', { code: 'EACCES', message: hostile }, false)).toContain('file permissions')
  })

  it('names a provider’s own terminal status in plain characters, kept whole', () => {
    expect(presented('flux', new ProviderStatusError('FLUX', 'Request Moderated', hostile), false))
      .toContain('“Request Moderated”')
    const shown = presented('flux', new ProviderStatusError('FLUX', '<b>/private/tmp/x</b>' + 'y'.repeat(80)), false)
    expect(shown).not.toContain('<')
    expect(shown).not.toContain('/private')
    expect(shown).toContain('y'.repeat(80))
  })

  it('distinguishes a paid generation whose local save failed', () => {
    const message = presented('nanobanana', new Error(hostile), true)
    expect(message).toContain('image was generated')
    expect(message).not.toContain(hostile)
  })

  it('names every file a launch stopped on, newer or unreadable, and what to do, keeping diagnostics out', () => {
    const settings = '/Users/me/.imagequeue/config.json'
    const keys = '/Users/me/.imagequeue/api-keys.json'
    const halted = text(startupFailurePresentation(new LaunchStopError([{ path: settings, newer: true }, { path: keys, newer: false }])))
    expect(halted).toContain('stopped before opening its main window because it can’t use these files')
    expect(halted).toContain(`${settings}: written by a newer version of ImageQueue\n${keys}: couldn’t be read`)
    expect(halted).toContain('Use the newer version of ImageQueue, or repair or restore each file, or move it away to start fresh.')
    expect(halted).not.toContain('hostile-sentinel')

    const other = text(startupFailurePresentation(new Error(hostile)))
    expect(other).toContain('stopped before opening its main window')
    expect(other).not.toContain('hostile-sentinel')
  })

  it('names a file a newer version wrote, and one that could not be read, when a request needed it', () => {
    const elaborators = '/Users/me/.imagequeue/elaborators.json'
    const notice = newerFilePresentation(elaborators)
    expect(text(notice.title)).toBe('File from a newer version')
    expect(text(notice.message)).toContain(`newer version of ImageQueue wrote the file at ${elaborators}`)

    const ledger = '/Users/me/.imagequeue/concepts.sqlite3'
    const left = unreadableFilePresentation(ledger)
    expect(text(left.title)).toBe('File couldn’t be read')
    expect(text(left.message)).toContain(`read the file at ${ledger}, so it left it unchanged`)
  })

  it('names the records and backup databases it switched off', () => {
    const records = recordsOffPresentation('/data/records.sqlite3')
    expect(text(records.title)).toBe('Records are off')
    expect(text(records.message)).toContain('/data/records.sqlite3, so it left it unchanged')
    const backups = backupsOffPresentation('/data/backups.sqlite3')
    expect(text(backups.title)).toBe('Backups are off')
    expect(text(backups.message)).toContain('/data/backups.sqlite3, so it left it unchanged')
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
