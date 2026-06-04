import { describe, expect, it } from 'vitest'
import {
  collectSessionThumbnails,
  createTaskCounts,
  isSessionManifest,
  normalizeResumedQueues,
  toInterruptedTask
} from './state'
import { createEmptyQueues } from '../queue/queue-manager'
import { BackendId, SESSION_MANIFEST_VERSION, Task, TaskStatus } from '../../shared/types'

function makeTask(id: string, status: TaskStatus, extra: Partial<Task> = {}): Task {
  return {
    id,
    prompt: 'p',
    backend: 'openai',
    model: 'm',
    params: {},
    status,
    estimatedCostUsd: 0.01,
    enqueuedAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:01.000Z',
    completedAt: '2026-01-01T00:00:02.000Z',
    durationMs: 1000,
    imagePath: '/x.png',
    baseName: 'base-' + id,
    error: null,
    ...extra
  }
}

function queuesWith(tasks: Task[]): Record<BackendId, Task[]> {
  const q = createEmptyQueues()
  for (const t of tasks) q[t.backend].push(t)
  return q
}

describe('createTaskCounts', () => {
  it('tallies totals and per-status counts', () => {
    const counts = createTaskCounts(queuesWith([
      makeTask('a', 'queued'),
      makeTask('b', 'completed'),
      makeTask('c', 'completed'),
      makeTask('d', 'failed')
    ]))
    expect(counts.total).toBe(4)
    expect(counts.completed).toBe(2)
    expect(counts.queued).toBe(1)
    expect(counts.failed).toBe(1)
    expect(counts.kept).toBe(0)
  })
})

describe('toInterruptedTask', () => {
  it('leaves completed and kept tasks untouched', () => {
    expect(toInterruptedTask(makeTask('a', 'completed')).status).toBe('completed')
    expect(toInterruptedTask(makeTask('b', 'kept')).status).toBe('kept')
  })

  it('marks in-flight tasks interrupted and clears per-attempt fields', () => {
    const result = toInterruptedTask(makeTask('a', 'generating', { error: 'boom' }))
    expect(result.status).toBe('interrupted')
    expect(result.startedAt).toBeNull()
    expect(result.completedAt).toBeNull()
    expect(result.durationMs).toBeNull()
    expect(result.imagePath).toBeNull()
    expect(result.baseName).toBeNull()
    expect(result.error).toBeNull()
  })
})

describe('normalizeResumedQueues', () => {
  it('interrupts unfinished work while preserving finished outputs', () => {
    const normalized = normalizeResumedQueues(queuesWith([
      makeTask('done', 'completed'),
      makeTask('mid', 'generating'),
      makeTask('wait', 'queued')
    ]))
    const byId = Object.fromEntries(normalized.openai.map((t) => [t.id, t.status]))
    expect(byId).toEqual({ done: 'completed', mid: 'interrupted', wait: 'interrupted' })
  })
})

describe('collectSessionThumbnails', () => {
  it('returns completed tasks newest-first, capped at the limit', () => {
    const thumbs = collectSessionThumbnails(queuesWith([
      makeTask('old', 'completed', { completedAt: '2026-01-01T00:00:00.000Z' }),
      makeTask('new', 'completed', { completedAt: '2026-03-01T00:00:00.000Z' }),
      makeTask('mid', 'completed', { completedAt: '2026-02-01T00:00:00.000Z' }),
      makeTask('pending', 'queued')
    ]), 2)
    expect(thumbs.map((t) => t.baseName)).toEqual(['base-new', 'base-mid'])
  })

  it('skips completed tasks that have no baseName', () => {
    const thumbs = collectSessionThumbnails(queuesWith([
      makeTask('a', 'completed', { baseName: null })
    ]))
    expect(thumbs).toEqual([])
  })
})

describe('isSessionManifest', () => {
  const valid = {
    version: SESSION_MANIFEST_VERSION,
    sessionId: 's',
    createdAt: 'now',
    updatedAt: 'now',
    lastResumedAt: null,
    taskCounts: {},
    elaboratedPrompts: ['a'],
    tasks: createEmptyQueues()
  }

  it('accepts a well-formed manifest', () => {
    expect(isSessionManifest(valid)).toBe(true)
  })

  it('rejects wrong version, missing fields, and malformed task maps', () => {
    expect(isSessionManifest(null)).toBe(false)
    expect(isSessionManifest({ ...valid, version: 999 })).toBe(false)
    expect(isSessionManifest({ ...valid, sessionId: 123 })).toBe(false)
    expect(isSessionManifest({ ...valid, elaboratedPrompts: 'nope' })).toBe(false)
    expect(isSessionManifest({ ...valid, elaboratedPrompts: [1, 2] })).toBe(false)
    expect(isSessionManifest({ ...valid, tasks: { openai: 'not-an-array' } })).toBe(false)
  })
})
