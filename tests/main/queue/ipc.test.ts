import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackendId, Task, TaskStatus } from '../../../src/shared/types'

// The queue channels the window drives. Two things matter here and are easy to
// get wrong: live work must never disappear because the renderer's view was a
// tick stale, and a task the user deleted must leave the queue even when its
// file could not be removed. The queue manager itself is real; only the log,
// the config, the session write, the publisher and the file removal are not.
type Handler = (...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  deleteToTrash: false,
  log: vi.fn(),
  logEnqueue: vi.fn(),
  persistActiveSession: vi.fn(),
  publishQueueState: vi.fn(),
  setQueuePausedAndPublish: vi.fn(),
  buildControlState: vi.fn(() => ({ canPause: true })),
  cancelAllInFlight: vi.fn(() => 2),
  isQueuePaused: vi.fn(() => false),
  deleteImageOutput: vi.fn(),
  trashImageOutput: vi.fn(async () => {}),
}))

vi.mock('../../../src/main/ipc-boundary', () => ({
  handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
}))
vi.mock('../../../src/main/config', () => ({
  loadConfig: () => ({ general: { delete_to_trash: mocks.deleteToTrash } }),
}))
vi.mock('../../../src/main/logger', () => ({
  log: mocks.log,
  logEnqueue: mocks.logEnqueue,
  serializeError: (error: unknown) => ({ error }),
}))
vi.mock('../../../src/main/session', () => ({ persistActiveSession: mocks.persistActiveSession }))
vi.mock('../../../src/main/queue/publisher', () => ({ publishQueueState: mocks.publishQueueState }))
vi.mock('../../../src/main/queue/control-actions', () => ({
  setQueuePausedAndPublish: mocks.setQueuePausedAndPublish,
}))
vi.mock('../../../src/main/queue/control-state', () => ({ buildControlState: mocks.buildControlState }))
vi.mock('../../../src/main/backends/cancellation', () => ({
  cancelAllInFlight: mocks.cancelAllInFlight,
  isQueuePaused: mocks.isQueuePaused,
}))
// imageExtFromPath stays real: which extension a task's file has is derived
// from the task itself, and the deletion paths turn on it.
vi.mock('../../../src/main/utils/file-output', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/utils/file-output')>()
  return { ...actual, deleteImageOutput: mocks.deleteImageOutput, trashImageOutput: mocks.trashImageOutput }
})

const { registerQueueIpc } = await import('../../../src/main/queue/ipc')
const { createEmptyQueues, queueManager } = await import('../../../src/main/queue/queue-manager')

function invoke(channel: string, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`${channel} was not registered`)
  return handler({}, ...args)
}

function makeTask(id: string, status: TaskStatus, extra: Partial<Task> = {}): Task {
  return {
    id,
    prompt: 'a cat',
    backend: 'openai',
    model: 'gpt-image-2',
    params: {},
    status,
    enqueuedAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    durationMs: null,
    imagePath: null,
    baseName: null,
    error: null,
    ...extra,
  }
}

function seed(tasks: Task[]): void {
  const queues = createEmptyQueues()
  for (const task of tasks) queues[task.backend].push(task)
  queueManager.replaceAllTasks(queues)
}

function statuses(backend: BackendId = 'openai'): [string, TaskStatus][] {
  return queueManager.getAllStoredTasks()[backend].map((task) => [task.id, task.status])
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.deleteToTrash = false
  mocks.handlers.clear()
  queueManager.replaceAllTasks(createEmptyQueues())
  registerQueueIpc()
})

describe('queueing work', () => {
  it('queues what was asked for, records each one, and saves the session', () => {
    const tasks = invoke('queue:enqueue', {
      prompt: 'a cat',
      backend: 'openai',
      model: 'gpt-image-2',
      params: { size: '1024x1024' },
      count: 2,
    }) as Task[]

    expect(tasks).toHaveLength(2)
    expect(statuses().map(([, status]) => status)).toEqual(['queued', 'queued'])
    expect(mocks.logEnqueue).toHaveBeenCalledTimes(2)
    expect(mocks.logEnqueue).toHaveBeenCalledWith(tasks[0].id, 'openai', 'gpt-image-2', 'a cat', { size: '1024x1024' }, 2)
    expect(mocks.persistActiveSession).toHaveBeenCalledOnce()
    expect(mocks.publishQueueState).toHaveBeenCalledOnce()
  })

  it('queues a batch across backends and records each unit against its own task', () => {
    const units = [
      { prompt: 'a cat', backend: 'openai' as const, model: 'gpt-image-2', params: {} },
      { prompt: 'a dog', backend: 'flux' as const, model: 'flux.2-pro', params: { steps: 4 } },
    ]

    const tasks = invoke('queue:enqueueBatch', units) as Task[]

    expect(tasks.map((task) => task.backend)).toEqual(['openai', 'flux'])
    expect(mocks.logEnqueue).toHaveBeenNthCalledWith(2, tasks[1].id, 'flux', 'flux.2-pro', 'a dog', { steps: 4 }, 1)
    expect(mocks.persistActiveSession).toHaveBeenCalledOnce()
  })

  it('hands back everything it holds', () => {
    seed([makeTask('a', 'queued')])

    expect(invoke('queue:getAllStoredTasks')).toEqual(queueManager.getAllStoredTasks())
  })
})

describe('taking a row out of the queue', () => {
  it('keeps a finished image instead of discarding it', () => {
    seed([makeTask('done', 'completed', { baseName: 'base-done', imagePath: '/out/base-done.png' })])

    invoke('queue:removeTask', 'openai', 'done')

    expect(statuses()).toEqual([['done', 'kept']])
    expect(mocks.log).toHaveBeenCalledWith('info', 'Task marked kept', expect.objectContaining({ taskId: 'done' }))
    expect(mocks.persistActiveSession).toHaveBeenCalledOnce()
  })

  it('removes one that never produced anything', () => {
    seed([makeTask('waiting', 'queued'), makeTask('other', 'queued')])

    invoke('queue:removeTask', 'openai', 'waiting')

    expect(statuses()).toEqual([['other', 'queued']])
  })

  it('refuses to take away work that is running', () => {
    seed([makeTask('running', 'generating')])

    invoke('queue:removeTask', 'openai', 'running')

    expect(statuses()).toEqual([['running', 'generating']])
    expect(mocks.log).toHaveBeenCalledWith('warn', 'Refusing to remove generating task', expect.anything())
    expect(mocks.persistActiveSession).not.toHaveBeenCalled()
  })

  it('does nothing for a row that is no longer there', () => {
    invoke('queue:removeTask', 'openai', 'gone')

    expect(mocks.persistActiveSession).not.toHaveBeenCalled()
    expect(mocks.publishQueueState).not.toHaveBeenCalled()
  })

  it('brings a kept image back into the list', () => {
    seed([makeTask('kept', 'kept', { baseName: 'base-kept' })])

    invoke('queue:restoreTask', 'openai', 'kept')

    expect(statuses()).toEqual([['kept', 'completed']])
    expect(mocks.publishQueueState).toHaveBeenCalledOnce()

    invoke('queue:restoreTask', 'openai', 'not-there')
    expect(mocks.publishQueueState, 'nothing to restore, nothing announced').toHaveBeenCalledOnce()
  })
})

describe('deleting a row together with its image', () => {
  const withFile = () =>
    makeTask('done', 'completed', { baseName: 'base-done', imagePath: '/out/base-done.png' })

  it('deletes the file for good and takes the row out', async () => {
    seed([withFile()])

    await invoke('queue:deleteWithFiles', 'openai', 'done')

    expect(mocks.deleteImageOutput).toHaveBeenCalledExactlyOnceWith('base-done', 'png')
    expect(mocks.trashImageOutput).not.toHaveBeenCalled()
    expect(statuses()).toEqual([])
    expect(mocks.persistActiveSession).toHaveBeenCalledOnce()
  })

  it('sends it to the Trash when the user keeps deletions recoverable', async () => {
    mocks.deleteToTrash = true
    seed([withFile()])

    await invoke('queue:deleteWithFiles', 'openai', 'done')

    expect(mocks.trashImageOutput).toHaveBeenCalledExactlyOnceWith('base-done', 'png')
    expect(statuses()).toEqual([])
  })

  it('still takes the row out when the file cannot be removed', async () => {
    seed([withFile()])
    mocks.deleteImageOutput.mockImplementation(() => {
      throw new Error('EPERM: operation not permitted')
    })

    await invoke('queue:deleteWithFiles', 'openai', 'done')

    expect(statuses(), 'the queue never diverges from what the user asked for').toEqual([])
    expect(mocks.log).toHaveBeenCalledWith(
      'error',
      'Failed to remove task files; removing the queue entry anyway',
      expect.anything(),
    )
  })

  it('refuses to delete work that is running', async () => {
    seed([makeTask('running', 'generating', { baseName: 'base-running' })])

    await invoke('queue:deleteWithFiles', 'openai', 'running')

    expect(statuses()).toEqual([['running', 'generating']])
    expect(mocks.deleteImageOutput).not.toHaveBeenCalled()
    expect(mocks.log).toHaveBeenCalledWith('warn', 'Refusing to delete generating task', expect.anything())
  })

  it.each([
    ['a row that never wrote a file', makeTask('failed', 'failed'), 'Task has no baseName; nothing to remove on disk'],
    [
      'a row whose file cannot be named',
      makeTask('odd', 'completed', { baseName: 'base-odd', imagePath: null }),
      'Cannot determine image extension; skipping file removal',
    ],
  ])('takes out %s without touching the disk', async (_case, task, warning) => {
    seed([task])

    await invoke('queue:deleteWithFiles', 'openai', task.id)

    expect(statuses()).toEqual([])
    expect(mocks.deleteImageOutput).not.toHaveBeenCalled()
    expect(mocks.log).toHaveBeenCalledWith('warn', warning, expect.anything())
  })

  it('does nothing for a row that is no longer there', async () => {
    await invoke('queue:deleteWithFiles', 'openai', 'gone')

    expect(mocks.persistActiveSession).not.toHaveBeenCalled()
  })
})

describe('trying again', () => {
  it('re-queues one failed row', () => {
    seed([makeTask('failed', 'failed', { error: 'rate limited' })])

    invoke('queue:retryTask', 'openai', 'failed')

    expect(statuses()).toEqual([['failed', 'queued']])
    expect(mocks.publishQueueState).toHaveBeenCalledOnce()
  })

  it('says nothing when there is nothing to retry', () => {
    invoke('queue:retryTask', 'openai', 'gone')

    expect(mocks.persistActiveSession).not.toHaveBeenCalled()
  })

  it('re-queues everything interrupted and says how much', () => {
    seed([makeTask('a', 'interrupted'), makeTask('b', 'interrupted'), makeTask('c', 'completed')])

    expect(invoke('queue:resumeInterrupted')).toBe(2)
    expect(statuses()).toEqual([['a', 'queued'], ['b', 'queued'], ['c', 'completed']])
    expect(mocks.log).toHaveBeenCalledWith('info', 'Resuming interrupted tasks', { count: 2 })
    expect(mocks.persistActiveSession).toHaveBeenCalledOnce()
  })

  it('stays quiet when nothing was interrupted', () => {
    expect(invoke('queue:resumeInterrupted')).toBe(0)
    expect(mocks.persistActiveSession).not.toHaveBeenCalled()
    expect(mocks.publishQueueState).not.toHaveBeenCalled()
  })
})

describe('the queue controls', () => {
  it('passes Pause and Resume to the one pause flag', () => {
    invoke('queue:setPaused', true)
    invoke('queue:setPaused', false)

    expect(mocks.setQueuePausedAndPublish.mock.calls).toEqual([[true], [false]])
  })

  it('stops what is queued and what is running, and reports both', () => {
    seed([makeTask('a', 'queued'), makeTask('b', 'queued'), makeTask('c', 'generating')])

    expect(invoke('queue:stopAll')).toEqual({ cancelled: 2, queued: 2 })
    expect(statuses().slice(0, 2)).toEqual([['a', 'interrupted'], ['b', 'interrupted']])
    expect(mocks.log).toHaveBeenCalledWith(
      'info',
      'Stopped all queue work',
      expect.objectContaining({ cancelled: 2, queued: 2, paused: false }),
    )
    expect(mocks.persistActiveSession).toHaveBeenCalledOnce()
  })

  it('clears what has not started and says how much went', () => {
    seed([makeTask('a', 'queued'), makeTask('b', 'completed')])

    expect(invoke('queue:clearPending')).toBe(1)
    expect(statuses()).toEqual([['b', 'completed']])
    expect(mocks.log).toHaveBeenCalledWith('info', 'Cleared pending tasks', { removed: 1 })
  })

  it('answers what the control menu may offer', () => {
    expect(invoke('queue:getControlState')).toEqual({ canPause: true })
    expect(mocks.buildControlState).toHaveBeenCalledOnce()
  })
})
