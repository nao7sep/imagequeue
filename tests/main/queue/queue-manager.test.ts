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

describe('queue changes by consumer', () => {
  let qm: QueueManager
  const acknowledge = (consumer: 'presentation' | 'durability'): void => {
    qm.ackChanges(consumer, qm.captureChanges(consumer).revision)
  }
  beforeEach(() => {
    qm = new QueueManager()
    acknowledge('presentation')
    acknowledge('durability')
  })

  it('captures an initial reset and only resets again when all tasks are replaced', () => {
    const fresh = new QueueManager()
    expect(fresh.captureChanges('presentation')).toEqual({ revision: 0, reset: createEmptyQueues(), upserts: [], removed: [] })
    seed(qm, [makeTask('replacement', 'queued')])
    const captured = qm.captureChanges('presentation')
    expect(captured.reset?.openai.map(task => task.id)).toEqual(['replacement'])
    qm.ackChanges('presentation', captured.revision)
    expect(qm.captureChanges('presentation')).toEqual({ revision: qm.currentRevision, upserts: [], removed: [] })
    qm.updateTask(qm.getTask('openai', 'replacement')!, { prompt: 'edited' })
    expect(qm.captureChanges('presentation').reset).toBeUndefined()
    expect(qm.captureChanges('presentation').upserts[0].prompt).toBe('edited')
    expect(qm.captureChanges('durability').reset?.openai[0].prompt).toBe('edited')
  })

  it('detaches captured reset and delta records including nested values from later changes', () => {
    seed(qm, [makeTask('a', 'failed')])
    const reset = qm.captureChanges('presentation')
    const task = qm.getTask('openai', 'a')!
    qm.updateTask(task, { params: { dimensions: { width: 512 } } })
    expect(reset.reset?.openai[0].params).toEqual({})
    acknowledge('presentation')
    qm.updateTask(task, { error: { key: 'taskFailure.generic', values: { name: 'before' } } })
    const captured = qm.captureChanges('presentation')
    qm.updateTask(task, { params: { dimensions: { width: 1024 } }, error: { key: 'taskFailure.generic', values: { name: 'after' } } })
    expect(captured.upserts[0].params).toEqual({ dimensions: { width: 512 } })
    expect(captured.upserts[0].error?.values?.name).toBe('before')
    const capturedDimensions = captured.upserts[0].params.dimensions as { width: number }
    capturedDimensions.width = 99
    expect(task.params).toEqual({ dimensions: { width: 1024 } })
  })

  it('acknowledges each consumer separately and retains a mutation newer than the captured revision', () => {
    const [task] = qm.enqueue({ prompt: 'first', backend: 'openai', model: 'm', params: {}, count: 1 })
    const first = qm.captureChanges('presentation')
    qm.updateTask(task, { prompt: 'second' })
    qm.ackChanges('presentation', first.revision)
    expect(qm.captureChanges('presentation').upserts.map(task => task.prompt)).toEqual(['second'])
    expect(qm.captureChanges('durability').upserts.map(task => task.prompt)).toEqual(['second'])
    acknowledge('presentation')
    expect(qm.captureChanges('presentation').upserts).toEqual([])
    expect(qm.captureChanges('durability').upserts).toHaveLength(1)
    acknowledge('durability')
    expect(qm.captureChanges('durability').upserts).toEqual([])
  })

  it('does not acknowledge a newer replacement with an older snapshot revision', () => {
    seed(qm, [makeTask('old', 'failed')])
    const old = qm.captureChanges('presentation')
    seed(qm, [makeTask('new', 'queued')])
    qm.ackChanges('presentation', old.revision)
    expect(qm.captureChanges('presentation').reset?.openai.map(task => task.id)).toEqual(['new'])
    expect(qm.getTask('openai', 'old')).toBeUndefined()
  })

  it('keeps first insertion order across repeated updates so new rows reconstruct newest-first', () => {
    const created = qm.enqueue({ prompt: 'p', backend: 'openai', model: 'm', params: {}, count: 3 })
    qm.updateTask(created[0], { status: 'generating' })
    qm.updateTask(created[1], { prompt: 'edited' })
    const changes = qm.captureChanges('presentation')
    expect(changes.upserts.map(task => task.id)).toEqual(created.map(task => task.id))
    const reconstructed: Task[] = []
    for (const task of changes.upserts) reconstructed.unshift(task)
    expect(reconstructed.map(task => task.id)).toEqual(qm.getAllStoredTasks().openai.map(task => task.id))
  })

  it('retains a newer deletion when an older upsert is acknowledged', () => {
    const [task] = qm.enqueue({ prompt: 'p', backend: 'openai', model: 'm', params: {}, count: 1 })
    const old = qm.captureChanges('presentation')
    qm.removeTask(task.backend, task.id)
    qm.ackChanges('presentation', old.revision)
    expect(qm.getTask(task.backend, task.id)).toBeUndefined()
    expect(qm.captureChanges('presentation')).toEqual({ revision: qm.currentRevision, upserts: [], removed: [{ backend: task.backend, id: task.id }] })
    acknowledge('presentation')
    expect(qm.captureChanges('presentation').removed).toEqual([])
  })

  it.each([
    { status: 'completed', operation: 'keepTask', expected: 'kept' },
    { status: 'kept', operation: 'restoreTask', expected: 'completed' },
    { status: 'failed', operation: 'retryTask', expected: 'queued' },
  ] as const)('tracks $operation as a single owned update', ({ status, operation, expected }) => {
    seed(qm, [makeTask('a', status)])
    acknowledge('presentation')
    qm[operation]('openai', 'a')
    expect(qm.captureChanges('presentation').upserts).toEqual([expect.objectContaining({ id: 'a', status: expected })])
  })

  it('tracks bulk transitions and deletions across backend indexes', () => {
    seed(qm, [makeTask('queued', 'queued'), makeTask('other', 'queued', 'flux'), makeTask('done', 'completed')])
    acknowledge('presentation')
    expect(qm.interruptQueuedTasks()).toBe(2)
    expect(qm.captureChanges('presentation').upserts.map(task => [task.id, task.status])).toEqual([
      ['queued', 'interrupted'], ['other', 'interrupted'],
    ])
    acknowledge('presentation')
    expect(qm.retryAllInterrupted()).toBe(2)
    expect(qm.captureChanges('presentation').upserts).toHaveLength(2)
    acknowledge('presentation')
    expect(qm.removePendingTasks()).toBe(2)
    expect(qm.captureChanges('presentation').removed).toEqual([{ backend: 'openai', id: 'queued' }, { backend: 'flux', id: 'other' }])
    expect(qm.getTask('openai', 'queued')).toBeUndefined()
    expect(qm.getTask('flux', 'other')).toBeUndefined()
    expect(qm.getTask('openai', 'done')?.status).toBe('completed')
  })

  it('records clearing pending output and omits undefined evidence from serialized capture', () => {
    seed(qm, [makeTask('a', 'failed')])
    acknowledge('durability')
    const task = qm.getTask('openai', 'a')!
    qm.updateTask(task, { pendingOutput: { baseName: 'output', ext: 'png', sha256: 'a'.repeat(64) } })
    const pending = qm.captureChanges('durability')
    qm.updateTask(task, { pendingOutput: undefined })
    qm.ackChanges('durability', pending.revision)
    const cleared = qm.captureChanges('durability')
    expect(cleared.upserts).toHaveLength(1)
    expect(JSON.parse(JSON.stringify(cleared)).upserts[0]).not.toHaveProperty('pendingOutput')
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
