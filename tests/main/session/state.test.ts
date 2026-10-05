import { describe, expect, it } from 'vitest'
import {
  normalizeElaboratedPrompts,
  collectSessionThumbnails,
  createTaskCounts,
  isSessionManifest,
  normalizeResumedQueues,
  sessionContentKey,
  toResumedTask
} from '../../../src/main/session/state'
import { createEmptyQueues } from '../../../src/main/queue/queue-manager'
import { BackendId, Task, TaskStatus } from '../../../src/shared/types'
import { createEmptySessionDraft } from '../../../src/shared/session-draft'

function makeTask(id: string, status: TaskStatus, extra: Partial<Task> = {}): Task {
  return {
    id,
    prompt: 'p',
    backend: 'openai',
    model: 'm',
    params: {},
    status,
    enqueuedAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:01.000Z',
    completedAt: '2026-01-01T00:00:02.000Z',
    durationMs: 1000,
    imagePath: '/x.png',
    baseName: 'base-' + id,
    error: null,
    providerMessage: null,
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

describe('toResumedTask', () => {
  it('leaves finished, failed and already interrupted tasks as they were stored', () => {
    const failed = makeTask('c', 'failed', {
      completedAt: null,
      imagePath: null,
      baseName: null,
      error: { key: 'taskFailure.refused', values: { name: 'OpenAI' } },
      providerMessage: 'Your request was rejected by the safety system.',
    })
    expect(toResumedTask(makeTask('a', 'completed')).status).toBe('completed')
    expect(toResumedTask(makeTask('b', 'kept')).status).toBe('kept')
    expect(toResumedTask(failed)).toEqual(failed)
    expect(toResumedTask(makeTask('d', 'interrupted')).status).toBe('interrupted')
  })

  it('marks in-flight tasks interrupted and clears per-attempt fields', () => {
    for (const status of ['generating', 'queued'] as const) {
      const result = toResumedTask(makeTask('a', status))
      expect(result.status).toBe('interrupted')
      expect(result.startedAt).toBeNull()
      expect(result.completedAt).toBeNull()
      expect(result.durationMs).toBeNull()
      expect(result.imagePath).toBeNull()
      expect(result.baseName).toBeNull()
      expect(result.error).toBeNull()
    }
  })
})

describe('normalizeResumedQueues', () => {
  it('interrupts only the work that was in flight', () => {
    const normalized = normalizeResumedQueues(queuesWith([
      makeTask('done', 'completed'),
      makeTask('refused', 'failed'),
      makeTask('mid', 'generating'),
      makeTask('wait', 'queued')
    ]))
    const byId = Object.fromEntries(normalized.openai.map((t) => [t.id, t.status]))
    expect(byId).toEqual({ done: 'completed', refused: 'failed', mid: 'interrupted', wait: 'interrupted' })
  })

  it('repairs duplicate task ids across backend queues while preserving every task', () => {
    const first = makeTask('same-id', 'completed')
    const second = makeTask('same-id', 'failed', { backend: 'grok' })
    const normalized = normalizeResumedQueues(queuesWith([first, second]))
    const tasks = [...normalized.openai, ...normalized.grok]

    expect(tasks).toHaveLength(2)
    expect(tasks[0].id).toBe('same-id')
    expect(tasks[1].id).not.toBe('same-id')
    expect(new Set(tasks.map((task) => task.id)).size).toBe(2)
  })
})

describe('sessionContentKey', () => {
  const draft = createEmptySessionDraft()
  const key = (tasks: Task[]): string => sessionContentKey(draft, [], queuesWith(tasks))

  it('ignores what is lifecycle: status, timing and failure', () => {
    const base = key([makeTask('a', 'completed')])
    expect(key([makeTask('a', 'kept')])).toBe(base)
    expect(key([makeTask('a', 'completed', { startedAt: null, completedAt: null, durationMs: null })])).toBe(base)
    expect(key([makeTask('a', 'completed', { error: { key: 'taskFailure.generic', values: { name: 'OpenAI' } }, providerMessage: 'x' })])).toBe(base)
  })

  it('changes with the request, the saved image, the task list, the draft and the prompts', () => {
    const base = key([makeTask('a', 'completed')])
    expect(key([makeTask('a', 'completed', { prompt: 'q' })])).not.toBe(base)
    expect(key([makeTask('a', 'completed', { params: { quality: 'high' } })])).not.toBe(base)
    expect(key([makeTask('a', 'completed', { baseName: 'other' })])).not.toBe(base)
    expect(key([makeTask('a', 'completed'), makeTask('b', 'queued')])).not.toBe(base)
    expect(sessionContentKey({ ...draft, prompt: 'a cat' }, [], queuesWith([makeTask('a', 'completed')]))).not.toBe(base)
    expect(sessionContentKey(draft, [{ text: 't', concepts: [] }], queuesWith([makeTask('a', 'completed')]))).not.toBe(base)
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
    sessionId: 's',
    createdAt: 'now',
    updatedAt: 'now',
    lastResumedAt: null,
    taskCounts: {},
    elaboratedPrompts: [{ text: 'a prompt', concepts: [{ facet: 'place', concept: 'cargo quay' }] }],
    draft: createEmptySessionDraft(),
    tasks: createEmptyQueues()
  }

  it('accepts a well-formed manifest', () => {
    expect(isSessionManifest(valid)).toBe(true)
  })

  // Per-entry junk must never invalidate the manifest — that costs the session
  // its whole task history for a display field. Junk is dropped on read.
  it('accepts a manifest whose prompt entries include junk', () => {
    expect(isSessionManifest({ ...valid, elaboratedPrompts: [42] })).toBe(true)
    expect(isSessionManifest({ ...valid, elaboratedPrompts: ['a bare string'] })).toBe(true)
  })

  it('keeps the records on read and drops every other entry', () => {
    const kept = normalizeElaboratedPrompts([
      'a bare string',
      42,
      { text: 7, concepts: [] },
      { text: 'good', concepts: [{ facet: 'place', concept: 'quay' }] },
      { text: 'x', concepts: [{ facet: 1 }] },
    ])
    expect(kept).toEqual([{ text: 'good', concepts: [{ facet: 'place', concept: 'quay' }] }])
  })

  it('rejects missing fields and malformed task maps', () => {
    expect(isSessionManifest(null)).toBe(false)
    expect(isSessionManifest({ ...valid, sessionId: 123 })).toBe(false)
    expect(isSessionManifest({ ...valid, elaboratedPrompts: 'nope' })).toBe(false)
    expect(isSessionManifest({ ...valid, tasks: { openai: 'not-an-array' } })).toBe(false)
  })

  it('rejects a manifest without its draft, and accepts one whose draft fields are malformed', () => {
    const { draft: _draft, ...withoutDraft } = valid
    expect(isSessionManifest(withoutDraft)).toBe(false)
    expect(isSessionManifest({ ...valid, draft: 'garbage' })).toBe(false)
    expect(isSessionManifest({ ...valid, draft: null })).toBe(false)
    expect(isSessionManifest({ ...valid, draft: { prompt: 7 } })).toBe(true)
  })

  // A session written before the Imagen backend was removed still carries an
  // `imagen` task list. It must open normally — the retired queue is simply not
  // read, never a reason to reject the session or fail opaquely.
  it('accepts a manifest carrying a task list for a retired backend', () => {
    const withRetired = {
      ...valid,
      tasks: { ...createEmptyQueues(), imagen: [makeTask('old', 'completed')] }
    }
    expect(isSessionManifest(withRetired)).toBe(true)
  })
})

describe('createEmptyQueues', () => {
  // readManifestFromDir rebuilds every loaded session's task map from this, copying
  // only the current backends across — which is what keeps a retired backend's saved
  // tasks from resurrecting a column that no longer exists.
  it('has exactly one queue per current backend and no retired ones', () => {
    expect(Object.keys(createEmptyQueues()).sort()).toEqual(
      ['drawthings', 'flux', 'grok', 'nanobanana', 'openai']
    )
  })
})
