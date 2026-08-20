import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueueManager } from '../../../src/main/queue/queue-manager'
import type { BackendId, Task } from '../../../src/shared/types'

// The queue-side half of stopping work. Both operations deliberately leave
// RUNNING tasks alone — cancelling those is the in-flight registry's job, and
// each lands here through its own failure path. The difference between them is
// recoverability: interrupting is retryable (it reuses the status a crash
// produces, so the existing per-row retry and Retry All already handle it),
// clearing is not.

vi.mock('nanoid', () => {
  let n = 0
  return { nanoid: () => `id-${++n}` }
})

// enqueue returns the live task objects (getAllStoredTasks hands back clones,
// so mutating those would change nothing).
function seed(manager: QueueManager, statuses: Task['status'][]): void {
  const tasks = manager.enqueue({
    prompt: 'p', backend: 'openai' as BackendId, model: 'm', params: {}, count: statuses.length,
  } as never)
  tasks.forEach((task, i) => { task.status = statuses[i] })
}

describe('queue control operations', () => {
  let manager: QueueManager

  beforeEach(() => {
    manager = new QueueManager()
  })

  it('interrupts waiting tasks and leaves generating, completed, and failed alone', () => {
    seed(manager, ['queued', 'generating', 'completed', 'failed', 'queued'])
    expect(manager.interruptQueuedTasks()).toBe(2)
    const statuses = manager.getAllStoredTasks().openai.map((t) => t.status)
    expect(statuses.filter((s) => s === 'interrupted')).toHaveLength(2)
    expect(statuses).toContain('generating')
    expect(statuses).toContain('completed')
    expect(statuses).toContain('failed')
  })

  // Interrupted is the status a crash mid-generation produces, and it already
  // has a retry path — which is why stopping deliberately reuses it.
  it('makes interrupted tasks retryable through the existing bulk retry', () => {
    seed(manager, ['queued', 'queued'])
    manager.interruptQueuedTasks()
    expect(manager.retryAllInterrupted()).toBe(2)
    expect(manager.getAllStoredTasks().openai.every((t) => t.status === 'queued')).toBe(true)
  })

  // Pending = queued + interrupted: everything that would still produce an
  // image. The first cut removed only `queued`, so clearing after a stop left
  // the interrupted tasks stranded — a partial no-op the developer caught in use.
  it('clears BOTH pending kinds — waiting and stopped — and touches nothing else', () => {
    seed(manager, ['queued', 'generating', 'completed', 'interrupted', 'failed', 'queued'])
    expect(manager.removePendingTasks()).toBe(3)
    const statuses = manager.getAllStoredTasks().openai.map((t) => t.status)
    expect(statuses).toHaveLength(3)
    expect(statuses).not.toContain('queued')
    expect(statuses).not.toContain('interrupted')
    expect(statuses).toContain('generating')
    expect(statuses).toContain('completed')
    expect(statuses).toContain('failed')
  })

  // Clearing is the one irreversible action in the menu: unlike stopping, the
  // tasks are gone, not retryable.
  it('leaves nothing to retry after clearing', () => {
    seed(manager, ['queued', 'interrupted'])
    manager.removePendingTasks()
    expect(manager.retryAllInterrupted()).toBe(0)
  })

  it('counts by status, which is what the menu enables against', () => {
    seed(manager, ['queued', 'queued', 'generating', 'interrupted'])
    expect(manager.countByStatus('queued')).toBe(2)
    expect(manager.countByStatus('generating')).toBe(1)
    expect(manager.countByStatus('interrupted')).toBe(1)
    expect(manager.countByStatus('completed')).toBe(0)
  })
})
