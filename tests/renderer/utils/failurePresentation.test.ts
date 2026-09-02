import { describe, expect, it } from 'vitest'
import { presentFailure, type FailureOperation } from '../../../src/renderer/src/utils/failurePresentation'

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
      const message = presentFailure(operation, error)
      expect(message).not.toContain(hostile)
      expect(message.length).toBeGreaterThan(20)
    }
    expect(error.cause).toBeInstanceOf(Error)
  })
})
