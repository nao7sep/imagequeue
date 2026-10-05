import { describe, expect, it } from 'vitest'
import {
  normalizeElaboratedPrompts,
  collectSessionThumbnails,
  createTaskCounts,
  isSessionManifest,
  normalizeResumedQueues,
  readStoredTask,
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

describe('readStoredTask', () => {
  const failed = (extra: Partial<Task>): Task => makeTask('f', 'failed', { completedAt: null, imagePath: null, baseName: null, ...extra })

  it('keeps a failure recorded as a message', () => {
    const error = { key: 'taskFailure.refusedWithReason', values: { name: 'Grok', reason: 'content moderated' } } as const
    expect(readStoredTask(failed({ error })).error).toEqual(error)
  })

  it('drops a failure an older build recorded as words, which may be the raw diagnostic', () => {
    const legacy = failed({ error: 'Grok API error 400: {"code":"x","usage":{"cost_in_usd_ticks":1}}' as unknown as Task['error'] })
    expect(readStoredTask(legacy).error).toBeNull()
  })

  it('reduces a provider message kept as the whole error body to the provider\'s reason', () => {
    const raw = '{"code":"imagine:content-moderated","error":"Generated image rejected by content moderation.","usage":{"cost_in_usd_ticks":600000000}}'
    expect(readStoredTask(failed({ backend: 'grok', providerMessage: raw })).providerMessage)
      .toBe('Generated image rejected by content moderation.')
    expect(readStoredTask(failed({ backend: 'flux', providerMessage: '{"detail":"Insufficient credits.","code":402}' })).providerMessage)
      .toBe('Insufficient credits.')
    expect(readStoredTask(failed({ backend: 'grok', providerMessage: '{"code":"internal","usage":{}}' })).providerMessage)
      .toBeNull()
  })

  it('keeps a provider message that is already the reason, and leaves an absent one absent', () => {
    expect(readStoredTask(failed({ providerMessage: 'Your request was rejected by the safety system.' })).providerMessage)
      .toBe('Your request was rejected by the safety system.')
    const { providerMessage: _absent, ...older } = failed({})
    expect('providerMessage' in readStoredTask(older as Task)).toBe(false)
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
    elaboratedPrompts: ['a'],
    tasks: createEmptyQueues()
  }

  it('accepts a well-formed manifest', () => {
    expect(isSessionManifest(valid)).toBe(true)
  })

  // elaboratedPrompts has held two shapes: bare strings, then records carrying
  // concept credits. BOTH must validate — this field sits inside the whole-
  // manifest check, so rejecting either shape would not lose the list, it
  // would lose the SESSION: an invalid manifest is unresumable, task history
  // and all. That cost is never justified by a display field.
  it('accepts both prompt shapes — legacy strings and concept-credited records', () => {
    expect(isSessionManifest({ ...valid, elaboratedPrompts: ['plain old string'] })).toBe(true)
    expect(isSessionManifest({
      ...valid,
      elaboratedPrompts: [{ text: 'a prompt', concepts: [{ facet: 'place', concept: 'cargo quay' }] }],
    })).toBe(true)
    expect(isSessionManifest({
      ...valid,
      elaboratedPrompts: ['legacy', { text: 'new', concepts: [] }],
    })).toBe(true)
  })

  // Per-entry junk must never invalidate the manifest — that costs the session
  // its whole task history for a display field. Junk is repaired away on read
  // instead, exactly as a malformed draft is.
  it('accepts a manifest whose prompt entries include junk', () => {
    expect(isSessionManifest({ ...valid, elaboratedPrompts: [42] })).toBe(true)
    expect(isSessionManifest({ ...valid, elaboratedPrompts: [{ text: 7, concepts: [] }] })).toBe(true)
  })

  it('repairs on read: strings normalize, junk drops, records survive', () => {
    const repaired = normalizeElaboratedPrompts([
      'legacy string',
      42,
      { text: 7, concepts: [] },
      { text: 'good', concepts: [{ facet: 'place', concept: 'quay' }] },
      { text: 'x', concepts: [{ facet: 1 }] },
    ])
    expect(repaired).toEqual([
      { text: 'legacy string', concepts: [] },
      { text: 'good', concepts: [{ facet: 'place', concept: 'quay' }] },
    ])
  })

  it('rejects missing fields and malformed task maps', () => {
    expect(isSessionManifest(null)).toBe(false)
    expect(isSessionManifest({ ...valid, sessionId: 123 })).toBe(false)
    expect(isSessionManifest({ ...valid, elaboratedPrompts: 'nope' })).toBe(false)
    // Junk ENTRIES no longer reject — they are repaired on read (see below);
    // only a non-array field shape does.
    expect(isSessionManifest({ ...valid, tasks: { openai: 'not-an-array' } })).toBe(false)
  })

  it('does not gate on the draft: absent or malformed drafts still validate', () => {
    // The draft is repaired on read (normalizeSessionDraft), not validated here,
    // so a missing or broken draft must never discard an otherwise-good session.
    expect(isSessionManifest(valid)).toBe(true) // no draft at all
    expect(isSessionManifest({ ...valid, draft: createEmptySessionDraft() })).toBe(true)
    expect(isSessionManifest({ ...valid, draft: 'garbage' })).toBe(true)
    expect(isSessionManifest({ ...valid, draft: null })).toBe(true)
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
