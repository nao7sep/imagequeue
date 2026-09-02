import { afterEach, describe, expect, it } from 'vitest'
import {
  inFlightCount,
  isQueuePaused,
  resetCancellationState,
} from '../../src/main/backends/cancellation'
import { queueManager } from '../../src/main/queue/queue-manager'
import { buildControlState } from '../../src/main/queue/control-state'
import {
  buildStatusIconAcceptanceQueues,
  installStatusIconAcceptanceFixture,
} from '../../src/main/status-icon-acceptance'

afterEach(() => {
  resetCancellationState()
  queueManager.replaceAllTasks({ openai: [], nanobanana: [], grok: [], flux: [], drawthings: [] })
})

describe('status-icon acceptance fixture', () => {
  it('builds the complete inert mixed-state queue', () => {
    const queues = buildStatusIconAcceptanceQueues('mixed', '2026-09-02T00:00:00.000Z')
    expect(queues.openai).toHaveLength(5)
    expect(queues.nanobanana.map((task) => task.status)).toEqual(['generating', 'generating'])
    expect(queues.grok[0]).toMatchObject({ status: 'failed', error: expect.any(String) })
    expect(queues.flux[0]).toMatchObject({ status: 'completed', durationMs: 1_234 })
    expect(queues.drawthings.map((task) => task.status)).toEqual(['interrupted', 'interrupted'])
  })

  it('installs fake generating claims and pauses without provider work', () => {
    expect(installStatusIconAcceptanceFixture('C:\\imagequeue-status-icon-acceptance-mixed', {
      IMAGEQUEUE_HOME: 'C:\\isolated-imagequeue-acceptance',
      IMAGEQUEUE_STATUS_ACCEPTANCE_STATE: 'mixed',
    })).toBe(true)
    expect(isQueuePaused()).toBe(true)
    expect(inFlightCount()).toBe(2)
    expect(queueManager.countByStatus('queued')).toBe(5)
    expect(queueManager.countByStatus('interrupted')).toBe(2)
  })

  it.each([
    ['idle', { paused: false, generating: 0, queued: 0, interrupted: 0 }],
    ['queued', { paused: false, generating: 0, queued: 5, interrupted: 0 }],
    ['generating', { paused: false, generating: 2, queued: 0, interrupted: 0 }],
    ['paused', { paused: true, generating: 0, queued: 5, interrupted: 0 }],
    ['failed', { paused: false, generating: 0, queued: 0, interrupted: 0 }],
    ['completed', { paused: false, generating: 0, queued: 0, interrupted: 0 }],
    ['interrupted', { paused: false, generating: 0, queued: 0, interrupted: 2 }],
    ['mixed', { paused: true, generating: 2, queued: 5, interrupted: 2 }],
  ] as const)('drives the authoritative %s control state', (state, expected) => {
    installStatusIconAcceptanceFixture(`C:\\imagequeue-status-icon-acceptance-${state}`, {
      IMAGEQUEUE_HOME: 'C:\\isolated-imagequeue-acceptance',
      IMAGEQUEUE_STATUS_ACCEPTANCE_STATE: state,
    })
    expect(buildControlState()).toEqual(expected)
  })

  it('does nothing without an explicit state and refuses the ordinary profile', () => {
    expect(installStatusIconAcceptanceFixture('C:\\ordinary-profile', {})).toBe(false)
    expect(() => installStatusIconAcceptanceFixture('C:\\imagequeue-status-icon-acceptance-queued', {
      IMAGEQUEUE_STATUS_ACCEPTANCE_STATE: 'queued',
    })).toThrow('requires an isolated IMAGEQUEUE_HOME')
    expect(() => installStatusIconAcceptanceFixture('C:\\imagequeue-status-icon-acceptance-surprise', {
      IMAGEQUEUE_HOME: 'C:\\isolated-imagequeue-acceptance',
      IMAGEQUEUE_STATUS_ACCEPTANCE_STATE: 'surprise',
    })).toThrow('must be one of')
    expect(() => installStatusIconAcceptanceFixture('C:\\ordinary-profile', {
      IMAGEQUEUE_HOME: 'C:\\ordinary-profile',
      IMAGEQUEUE_STATUS_ACCEPTANCE_STATE: 'idle',
    })).toThrow('refuses a profile outside')
  })
})
