import { describe, expect, it } from 'vitest'
import { presentFailure, type FailureOperation } from '../../../src/renderer/src/utils/failurePresentation'
import { loadTranslator } from '../../../src/shared/i18n/translate'

const { t } = await loadTranslator('en')

const hostile = 'EACCES Error invoking remote method IPC /private/tmp/hostile-sentinel'

describe('presentFailure', () => {
  it('never exposes an arbitrary renderer or IPC exception', () => {
    const operations: FailureOperation[] = [
      'settings-save', 'sessions-load', 'session-resume', 'session-create', 'session-delete',
      'session-folder', 'concepts-load', 'concept-details-load', 'concepts-change',
      'elaborators-load', 'elaborators-change', 'drawthings-models-load', 'drawthings-cli-load',
      'drawthings-catalog-load', 'advanced-elaborators-load', 'advanced-models-load',
      'advanced-elaborate', 'advanced-queue', 'elaboration-defaults-load', 'elaboration-save',
      'dependencies-load', 'dependencies-change', 'dependencies-cancel',
    ]
    const error = new Error(hostile, { cause: new Error('root cause') })

    for (const operation of operations) {
      const message = t(presentFailure(operation, error))
      expect(message).not.toContain(hostile)
      expect(message.length).toBeGreaterThan(20)
    }
    expect(error.cause).toBeInstanceOf(Error)
  })
})

it('describes a timed-out storage wait as still pending rather than a failed effect', () => {
  const message = t(presentFailure('session-resume', new Error("Error invoking remote method 'session:resume': Error: IMAGEQUEUE_STORAGE_STILL_PENDING")))
  expect(message).toContain('may still complete')
  expect(message).not.toContain('IMAGEQUEUE_STORAGE')
})
