import type { BackendId, Task, TaskStatus } from '../shared/types'
import path from 'path'
import {
  clearInFlight,
  registerInFlight,
  setQueuePaused,
} from './backends/cancellation'
import { log } from './logger'
import { createEmptyQueues, queueManager } from './queue/queue-manager'

export const STATUS_ICON_ACCEPTANCE_ENV = 'IMAGEQUEUE_STATUS_ACCEPTANCE_STATE'

export const STATUS_ICON_ACCEPTANCE_STATES = [
  'idle',
  'queued',
  'generating',
  'paused',
  'failed',
  'completed',
  'interrupted',
  'mixed',
] as const

export type StatusIconAcceptanceState = typeof STATUS_ICON_ACCEPTANCE_STATES[number]

const ACCEPTANCE_TASK_PREFIX = 'status-acceptance-'

function task(
  backend: BackendId,
  status: TaskStatus,
  ordinal: number,
  now: string,
): Task {
  const finished = status === 'completed' || status === 'kept' || status === 'failed'
  const running = status === 'generating'
  return {
    id: `${ACCEPTANCE_TASK_PREFIX}${status}-${ordinal}`,
    prompt: `Notification-area ${status} fixture ${ordinal}`,
    backend,
    model: 'Acceptance fixture — no provider call',
    params: {},
    status,
    enqueuedAt: now,
    startedAt: running || finished ? now : null,
    completedAt: finished ? now : null,
    durationMs: finished ? 1_234 : null,
    imagePath: null,
    baseName: null,
    error: status === 'failed' ? 'Synthetic failure for status-icon acceptance.' : null,
  }
}

export function buildStatusIconAcceptanceQueues(
  state: StatusIconAcceptanceState,
  now = new Date().toISOString(),
): ReturnType<typeof createEmptyQueues> {
  const queues = createEmptyQueues()
  const add = (backend: BackendId, status: TaskStatus, count: number): void => {
    for (let ordinal = 1; ordinal <= count; ordinal++) {
      queues[backend].push(task(backend, status, ordinal, now))
    }
  }

  if (state === 'queued' || state === 'paused' || state === 'mixed') add('openai', 'queued', 5)
  if (state === 'generating' || state === 'mixed') add('nanobanana', 'generating', 2)
  if (state === 'failed' || state === 'mixed') add('grok', 'failed', 1)
  if (state === 'completed' || state === 'mixed') add('flux', 'completed', 1)
  if (state === 'interrupted' || state === 'mixed') add('drawthings', 'interrupted', 2)
  return queues
}

function parseState(value: string | undefined): StatusIconAcceptanceState | null {
  if (!value) return null
  return STATUS_ICON_ACCEPTANCE_STATES.find((state) => state === value) ?? null
}

/**
 * Installs inert queue data for packaged notification-area acceptance. The
 * caller must skip the real processor when this returns true: queued rows must
 * remain queued, and generating rows are represented by harmless in-memory
 * claims rather than provider calls. Requiring an explicit IMAGEQUEUE_HOME
 * keeps the fixture out of the ordinary profile.
 */
export function installStatusIconAcceptanceFixture(
  dataRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const requested = env[STATUS_ICON_ACCEPTANCE_ENV]
  const state = parseState(requested)
  if (!requested) return false
  if (!state) {
    throw new Error(
      `${STATUS_ICON_ACCEPTANCE_ENV} must be one of: ${STATUS_ICON_ACCEPTANCE_STATES.join(', ')}`,
    )
  }
  if (!env['IMAGEQUEUE_HOME']?.trim()) {
    throw new Error(`${STATUS_ICON_ACCEPTANCE_ENV} requires an isolated IMAGEQUEUE_HOME`)
  }
  if (!path.basename(dataRoot).startsWith('imagequeue-status-icon-acceptance-')) {
    throw new Error(
      `${STATUS_ICON_ACCEPTANCE_ENV} refuses a profile outside an imagequeue-status-icon-acceptance-* directory`,
    )
  }

  for (const existing of Object.values(queueManager.getAllStoredTasks()).flat()) {
    if (existing.id.startsWith(ACCEPTANCE_TASK_PREFIX)) clearInFlight(existing.id)
  }
  const queues = buildStatusIconAcceptanceQueues(state)
  queueManager.replaceAllTasks(queues)
  setQueuePaused(state === 'paused' || state === 'mixed')
  for (const current of Object.values(queues).flat()) {
    if (current.status === 'generating') {
      registerInFlight(current.id, () => undefined, Promise.resolve())
    }
  }
  log('info', 'Installed status-icon acceptance fixture', { state })
  return true
}
