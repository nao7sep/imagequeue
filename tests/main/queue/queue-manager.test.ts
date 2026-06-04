import { beforeEach, describe, expect, it } from 'vitest'
import { QueueManager, createEmptyQueues } from '../../../src/main/queue/queue-manager'
import { BackendId, Task, TaskStatus } from '../../../src/shared/types'

// Builds a fully-populated task so status-transition tests can flip one field
// and assert the requeue logic clears the rest.
function makeTask(id: string, status: TaskStatus, backend: BackendId = 'openai'): Task {
  return {
    id,
    prompt: 'p',
    backend,
    model: 'm',
    params: {},
    status,
    estimatedCostUsd: 0.01,
    enqueuedAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:01.000Z',
    completedAt: '2026-01-01T00:00:02.000Z',
    durationMs: 1000,
    imagePath: '/x.png',
    baseName: 'x',
    error: 'boom'
  }
}

function seed(qm: QueueManager, tasks: Task[]): void {
  const queues = createEmptyQueues()
  for (const t of tasks) queues[t.backend].push(t)
  qm.replaceAllTasks(queues)
}

describe('QueueManager', () => {
  let qm: QueueManager
  beforeEach(() => { qm = new QueueManager() })

  it('inserts enqueued tasks newest-first and returns them in request order', () => {
    const tasks = qm.enqueue({ prompt: 'p', backend: 'openai', model: 'm', params: {}, count: 3 })
    expect(tasks).toHaveLength(3)
    // Returned in creation order, but stored newest-first (unshift).
    const stored = qm.getActiveTasks('openai')
    expect(stored.map((t) => t.id)).toEqual([tasks[2].id, tasks[1].id, tasks[0].id])
  })

  it('clones tasks on replaceAllTasks so external mutation does not leak in', () => {
    const original = makeTask('a', 'queued')
    seed(qm, [original])
    original.status = 'failed'
    expect(qm.getTask('openai', 'a')!.status).toBe('queued')
  })

  describe('status-gated transitions', () => {
    it('keeps only completed tasks', () => {
      seed(qm, [makeTask('a', 'completed'), makeTask('b', 'queued')])
      expect(qm.keepTask('openai', 'a')!.status).toBe('kept')
      expect(qm.keepTask('openai', 'b')).toBeUndefined()
    })

    it('restores only kept tasks', () => {
      seed(qm, [makeTask('a', 'kept'), makeTask('b', 'completed')])
      expect(qm.restoreTask('openai', 'a')!.status).toBe('completed')
      expect(qm.restoreTask('openai', 'b')).toBeUndefined()
    })

    it('retries only failed or interrupted tasks and clears per-attempt fields', () => {
      seed(qm, [makeTask('a', 'failed'), makeTask('b', 'completed')])
      const retried = qm.retryTask('openai', 'a')!
      expect(retried.status).toBe('queued')
      expect(retried.error).toBeNull()
      expect(retried.startedAt).toBeNull()
      expect(retried.completedAt).toBeNull()
      expect(retried.durationMs).toBeNull()
      expect(qm.retryTask('openai', 'b')).toBeUndefined()
    })
  })

  it('counts and requeues every interrupted task across backends', () => {
    seed(qm, [
      makeTask('a', 'interrupted', 'openai'),
      makeTask('b', 'interrupted', 'flux'),
      makeTask('c', 'completed', 'grok')
    ])
    expect(qm.retryAllInterrupted()).toBe(2)
    expect(qm.getTask('openai', 'a')!.status).toBe('queued')
    expect(qm.getTask('flux', 'b')!.status).toBe('queued')
    expect(qm.getTask('grok', 'c')!.status).toBe('completed')
  })

  it('hides kept tasks from the active view', () => {
    seed(qm, [makeTask('a', 'completed'), makeTask('b', 'kept')])
    expect(qm.getActiveTasks('openai').map((t) => t.id)).toEqual(['a'])
  })

  it('reorders active tasks while pinning kept tasks at the end', () => {
    seed(qm, [makeTask('a', 'queued'), makeTask('k', 'kept'), makeTask('b', 'queued'), makeTask('c', 'queued')])
    qm.reorderTasks('openai', ['c', 'a', 'b'])
    const all = qm.getAllStoredTasks().openai.map((t) => t.id)
    expect(all).toEqual(['c', 'a', 'b', 'k'])
  })

  it('enqueueBatch inserts units newest-first across backends', () => {
    const tasks = qm.enqueueBatch([
      { prompt: 'p1', backend: 'openai', model: 'm', params: {} },
      { prompt: 'p2', backend: 'flux', model: 'm', params: {} },
      { prompt: 'p3', backend: 'openai', model: 'm', params: {} }
    ])
    expect(tasks.map((t) => t.prompt)).toEqual(['p1', 'p2', 'p3'])
    // Within openai, p3 was enqueued after p1, so it sits in front.
    expect(qm.getActiveTasks('openai').map((t) => t.prompt)).toEqual(['p3', 'p1'])
    expect(qm.getActiveTasks('flux').map((t) => t.prompt)).toEqual(['p2'])
  })

  it('getAllVisibleTasks omits kept tasks; getAllStoredTasks keeps and clones them', () => {
    seed(qm, [makeTask('a', 'completed'), makeTask('k', 'kept')])
    expect(qm.getAllVisibleTasks().openai.map((t) => t.id)).toEqual(['a'])

    const stored = qm.getAllStoredTasks()
    expect(stored.openai.map((t) => t.id)).toEqual(['a', 'k'])
    // Stored snapshot is a clone — mutating it does not affect the manager.
    stored.openai[0].status = 'failed'
    expect(qm.getTask('openai', 'a')!.status).toBe('completed')
  })

  it('reorderTasks ignores ids that are absent or non-active', () => {
    seed(qm, [makeTask('a', 'queued'), makeTask('b', 'queued')])
    qm.reorderTasks('openai', ['ghost', 'b', 'a'])
    expect(qm.getActiveTasks('openai').map((t) => t.id)).toEqual(['b', 'a'])
  })

  it('removes a task by id and reports generating state', () => {
    seed(qm, [makeTask('a', 'generating'), makeTask('b', 'queued')])
    expect(qm.hasGeneratingTasks()).toBe(true)
    expect(qm.removeTask('openai', 'a')!.id).toBe('a')
    expect(qm.hasGeneratingTasks()).toBe(false)
    expect(qm.removeTask('openai', 'nope')).toBeUndefined()
  })
})
