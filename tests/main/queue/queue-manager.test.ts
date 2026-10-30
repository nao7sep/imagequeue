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
    enqueuedAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:01.000Z',
    completedAt: '2026-01-01T00:00:02.000Z',
    durationMs: 1000,
    imagePath: '/x.png',
    baseName: 'x',
    error: { key: 'taskFailure.generic', values: { name: 'OpenAI' } },
    providerMessage: null,
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

  it('refuses a task whose numbers its column\'s fields would not accept, queueing nothing', () => {
    expect(() => qm.enqueue({ prompt: 'p', backend: 'drawthings', model: 'm.ckpt', params: { width: 1000, height: 1024, steps: 4, guidance: 1 }, count: 1 })).toThrow('out of range')
    expect(() => qm.enqueueBatch([
      { prompt: 'p', backend: 'flux', model: 'flux-2-flex', params: { steps: 0, guidance: 5 } },
    ])).toThrow('out of range')
    expect(qm.getActiveTasks('drawthings')).toHaveLength(0)
    expect(qm.getActiveTasks('flux')).toHaveLength(0)
  })

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

  it('getAllStoredTasks keeps and clones kept tasks', () => {
    seed(qm, [makeTask('a', 'completed'), makeTask('k', 'kept')])

    const stored = qm.getAllStoredTasks()
    expect(stored.openai.map((t) => t.id)).toEqual(['a', 'k'])
    // Stored snapshot is a clone — mutating it does not affect the manager.
    stored.openai[0].status = 'failed'
    expect(qm.getTask('openai', 'a')!.status).toBe('completed')
  })

  it('removes a task by id and reports generating state', () => {
    seed(qm, [makeTask('a', 'generating'), makeTask('b', 'queued')])
    expect(qm.hasGeneratingTasks()).toBe(true)
    expect(qm.removeTask('openai', 'a')!.id).toBe('a')
    expect(qm.hasGeneratingTasks()).toBe(false)
    expect(qm.removeTask('openai', 'nope')).toBeUndefined()
  })

  it('reports queued state across backends (drives the drain-idle check)', () => {
    expect(qm.hasQueuedTasks()).toBe(false)
    seed(qm, [makeTask('a', 'generating'), makeTask('b', 'queued', 'flux')])
    expect(qm.hasQueuedTasks()).toBe(true)
    // Only a 'queued' task counts: generating/completed/failed do not.
    seed(qm, [makeTask('a', 'generating'), makeTask('c', 'completed')])
    expect(qm.hasQueuedTasks()).toBe(false)
  })
})

describe('task index', () => {
  let qm: QueueManager
  beforeEach(() => {
    qm = new QueueManager()
  })

  it('forgets removed tasks across backend indexes', () => {
    seed(qm, [makeTask('queued', 'queued'), makeTask('other', 'queued', 'flux'), makeTask('done', 'completed')])
    expect(qm.removePendingTasks()).toBe(2)
    expect(qm.getTask('openai', 'queued')).toBeUndefined()
    expect(qm.getTask('flux', 'other')).toBeUndefined()
    expect(qm.getTask('openai', 'done')?.status).toBe('completed')
    qm.removeTask('openai', 'done')
    expect(qm.getTask('openai', 'done')).toBeUndefined()
  })

  it('rejects foreign or retired references and changes to indexed identity', () => {
    seed(qm, [makeTask('a', 'queued')])
    const retired = qm.getTask('openai', 'a')!
    seed(qm, [makeTask('a', 'queued')])
    expect(() => qm.updateTask(retired, { prompt: 'lost' })).toThrow('not owned')
    const current = qm.getTask('openai', 'a')!
    expect(() => qm.updateTask(current, { id: 'changed' })).toThrow('identity')
    expect(() => qm.updateTask(current, { backend: 'flux' })).toThrow('identity')
    expect(qm.getTask('openai', 'a')).toBe(current)
  })

  it('answers visible presence without materializing queue snapshots', () => {
    seed(qm, [makeTask('kept', 'kept'), makeTask('queued', 'queued', 'flux')])
    expect(qm.hasVisibleTasks('openai', false)).toBe(false)
    expect(qm.hasVisibleTasks('openai', true)).toBe(true)
    expect(qm.hasVisibleTasks('flux', false)).toBe(true)
    expect(qm.hasVisibleTasks('drawthings', true)).toBe(false)
  })
})
