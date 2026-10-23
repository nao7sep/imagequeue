import { describe, expect, it } from 'vitest'
import { applyQueueDelta, type QueueDelta } from '../../src/shared/queue-updates'
import type { BackendId, Task } from '../../src/shared/types'

function task(id: string, backend: BackendId = 'openai'): Task {
  return {
    id, backend, prompt: id, model: 'model', params: {}, status: 'queued',
    enqueuedAt: '2026-10-01T00:00:00Z', startedAt: null, completedAt: null,
    durationMs: null, imagePath: null, baseName: null, error: null, providerMessage: null,
  }
}
const queues = (): Record<BackendId, Task[]> => ({ openai: [], nanobanana: [], grok: [], flux: [], drawthings: [] })
const delta = (upserts: Task[], removed: QueueDelta['removed'] = []): QueueDelta => ({
  kind: 'delta', baseRevision: 4, revision: 5, upserts, removed,
})

describe('queue delta projection', () => {
  it('replaces changed rows immutably while retaining untouched backend arrays and row identities', () => {
    const current = queues()
    const first = task('first')
    const second = task('second')
    const remote = task('remote', 'grok')
    current.openai = [first, second]
    current.grok = [remote]
    for (const list of Object.values(current)) {
      list.forEach((row) => Object.freeze(row))
      Object.freeze(list)
    }
    Object.freeze(current)
    const updated = { ...first, status: 'generating' as const }
    const next = applyQueueDelta(current, delta([updated]))
    expect(next).not.toBe(current)
    expect(next.openai).not.toBe(current.openai)
    expect(next.openai).toEqual([updated, second])
    expect(next.openai[0]).toBe(updated)
    expect(next.openai[1]).toBe(second)
    expect(current.openai).toEqual([first, second])
    expect(first.status).toBe('queued')
    for (const backend of ['nanobanana', 'grok', 'flux', 'drawthings'] as const) {
      expect(next[backend]).toBe(current[backend])
    }
    expect(next.grok[0]).toBe(remote)
  })

  it('prepends newly enqueued rows newest-first while updating existing rows in place', () => {
    const current = queues()
    const old = task('old')
    const oldest = task('oldest')
    current.openai = [old, oldest]
    const updated = { ...oldest, status: 'completed' as const }
    const addedFirst = task('new-first')
    const addedLast = task('new-last')
    const next = applyQueueDelta(current, delta([addedFirst, updated, addedLast]))
    expect(next.openai.map((row) => row.id)).toEqual(['new-last', 'new-first', 'old', 'oldest'])
    expect(next.openai[2]).toBe(old)
    expect(next.openai[3]).toBe(updated)
    expect(current.openai.map((row) => row.id)).toEqual(['old', 'oldest'])
  })

  it('removes only the specified backend row while applying simultaneous changes elsewhere', () => {
    const current = queues()
    const survivor = task('survivor')
    const otherBackend = task('same-id', 'grok')
    current.openai = [task('same-id'), survivor]
    current.grok = [otherBackend]
    const added = task('added', 'flux')
    const next = applyQueueDelta(current, delta([added], [{ backend: 'openai', id: 'same-id' }]))
    expect(next.openai).toEqual([survivor])
    expect(next.openai[0]).toBe(survivor)
    expect(next.grok).toBe(current.grok)
    expect(next.grok[0]).toBe(otherBackend)
    expect(next.flux).toEqual([added])
    expect(current.openai).toHaveLength(2)
    expect(current.flux).toEqual([])
  })
})
