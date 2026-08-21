import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../../../src/shared/types'

// The handler-level half of the queue-control semantics: Stop is an ACT on the
// work, orthogonal to Pause (a MODE). The first design entangled them —
// queue:stopAll called setQueuePaused(true) — which forced Retry to unpause
// and made "the queue is quiet" ambiguous between "nothing to run" and "a mode
// is set". These pin the disentangled contract at the IPC boundary, where the
// entanglement lived.

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    },
  },
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('../../../src/main/session', () => ({ persistActiveSession: () => undefined }))
vi.mock('nanoid', () => {
  let n = 0
  return { nanoid: () => `id-${++n}` }
})

const { registerQueueIpc } = await import('../../../src/main/queue/ipc')
const { queueManager } = await import('../../../src/main/queue/queue-manager')
const { isQueuePaused, resetCancellationState, registerInFlight } = await import(
  '../../../src/main/backends/cancellation'
)

registerQueueIpc()

const invoke = (channel: string, ...args: unknown[]): unknown => {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return fn({}, ...args)
}

function seed(statuses: Task['status'][]): Task[] {
  const tasks = queueManager.enqueue({
    prompt: 'p', backend: 'openai', model: 'm', params: {}, count: statuses.length,
  } as never)
  tasks.forEach((task, i) => { task.status = statuses[i] })
  return tasks
}

beforeEach(() => {
  resetCancellationState()
  queueManager.replaceAllTasks({ openai: [], nanobanana: [], grok: [], flux: [], drawthings: [] })
})

describe('queue:stopAll', () => {
  it('interrupts queued tasks and cancels in-flight ones', async () => {
    const tasks = seed(['queued', 'generating', 'queued'])
    let aborted = false
    registerInFlight(tasks[1].id, () => { aborted = true }, Promise.resolve())

    const result = await invoke('queue:stopAll')
    expect(result).toEqual({ cancelled: 1, queued: 2 })
    expect(aborted).toBe(true)
    const statuses = queueManager.getAllStoredTasks().openai.map((t) => t.status)
    expect(statuses.filter((s) => s === 'interrupted')).toHaveLength(2)
  })

  it('does NOT pause: stopping is an act on the work, never a mode', async () => {
    seed(['queued', 'queued'])
    await invoke('queue:stopAll')
    expect(isQueuePaused()).toBe(false)
  })

  it('leaves a pause the user set standing — and does not resume it either', async () => {
    seed(['queued'])
    await invoke('queue:setPaused', true)
    await invoke('queue:stopAll')
    expect(isQueuePaused()).toBe(true)
  })
})

describe('queue:clearPending', () => {
  it('removes both pending kinds through the handler', async () => {
    seed(['queued', 'interrupted', 'generating', 'completed'])
    expect(await invoke('queue:clearPending')).toBe(2)
    const statuses = queueManager.getAllStoredTasks().openai.map((t) => t.status)
    expect(statuses).toEqual(expect.arrayContaining(['generating', 'completed']))
    expect(statuses).toHaveLength(2)
  })
})
