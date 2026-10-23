import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  refreshMinimum: vi.fn(),
  log: vi.fn(),
  state: { paused: false, generating: 1, queued: 2, interrupted: 3 },
  tasks: { openai: [] },
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ webContents: { send: mocks.send } }] },
}))
vi.mock('../../../src/main/main-window-layout', () => ({
  refreshMainWindowMinimumSize: mocks.refreshMinimum,
}))
vi.mock('../../../src/main/logger', () => ({
  log: mocks.log,
  serializeError: (error: unknown) => String(error),
}))
vi.mock('../../../src/main/queue/control-state', () => ({
  buildControlState: () => mocks.state,
}))


const {
  publishQueueControlState,
  publishQueueState,
  subscribeQueueControlState, getQueueSnapshot, unsubscribeQueue,
} = await import('../../../src/main/queue/publisher')

const { queueManager, createEmptyQueues } = await import('../../../src/main/queue/queue-manager')
let sender: WebContents
beforeEach(() => {
  vi.clearAllMocks()
  queueManager.replaceAllTasks(createEmptyQueues())
  sender = Object.assign(new EventEmitter(), { send: vi.fn() }) as unknown as WebContents
  getQueueSnapshot(sender)
})
afterEach(() => unsubscribeQueue(sender))

describe('queue control publication', () => {
  it('keeps committed publication successful despite renderer and geometry failure', () => {
    mocks.send.mockImplementationOnce(() => { throw new Error('renderer destroyed') })
    mocks.refreshMinimum.mockImplementationOnce(() => { throw new Error('geometry unavailable') })
    const healthy = vi.fn()
    const unsubscribe = subscribeQueueControlState(healthy)
    try {
      expect(() => publishQueueState()).not.toThrow()
      expect(healthy).toHaveBeenLastCalledWith(mocks.state)
      expect(mocks.send).toHaveBeenCalledWith('queue:controlState', mocks.state)
    } finally { unsubscribe() }
  })
  it('isolates native presentation failures from queue publication', () => {
    const throwing = vi.fn(() => { throw new Error('menu failed') })
    const healthy = vi.fn()
    const unsubscribeThrowing = subscribeQueueControlState(throwing)
    const unsubscribeHealthy = subscribeQueueControlState(healthy)

    expect(() => publishQueueControlState()).not.toThrow()
    expect(healthy).toHaveBeenLastCalledWith(mocks.state)
    expect(mocks.send).toHaveBeenCalledWith('queue:controlState', mocks.state)
    expect(mocks.log).toHaveBeenCalledWith(
      'warn',
      'Queue control presentation listener failed',
      expect.any(Object),
    )

    unsubscribeThrowing()
    unsubscribeHealthy()
  })

  it('publishes queue data and the matching control snapshot together', () => {
    publishQueueState()
    expect(sender.send).toHaveBeenCalledWith('queue:updated', expect.objectContaining({ kind: 'snapshot', tasks: queueManager.getAllStoredTasks() }))
    expect(mocks.send).toHaveBeenCalledWith('queue:controlState', mocks.state)
    expect(mocks.refreshMinimum).toHaveBeenCalled()
  })
})

it('sends only changed rows to subscribers, and releases destroyed or unsubscribed consumers', () => {
  publishQueueState()
  vi.mocked(sender.send).mockClear()
  const other = Object.assign(new EventEmitter(), { send: vi.fn() }) as unknown as WebContents
  getQueueSnapshot(other)
  expect(other.listenerCount('destroyed')).toBe(1)
  getQueueSnapshot(other)
  expect(other.listenerCount('destroyed')).toBe(1)
  const [task] = queueManager.enqueue({ backend: 'openai', model: 'm', prompt: 'p', params: {}, count: 1 })
  publishQueueState()
  expect(sender.send).toHaveBeenLastCalledWith('queue:updated', expect.objectContaining({ kind: 'delta', upserts: [task], removed: [] }))
  expect(mocks.send.mock.calls.some(([channel]) => channel === 'queue:updated')).toBe(false)
  other.emit('destroyed')
  expect(other.listenerCount('render-process-gone')).toBe(0)
  vi.mocked(other.send).mockClear()
  unsubscribeQueue(sender)
  expect(sender.listenerCount('destroyed')).toBe(0)
  queueManager.updateTask(task, { status: 'generating' })
  publishQueueState()
  expect(other.send).not.toHaveBeenCalled()
})

it('keeps publication alive when a subscribed renderer send fails', () => {
  vi.mocked(sender.send).mockImplementationOnce(() => { throw new Error('gone') })
  expect(() => publishQueueState()).not.toThrow()
  const snapshot = getQueueSnapshot(sender)
  expect(snapshot.revision).toBe(queueManager.currentRevision)
  expect(mocks.log).toHaveBeenCalledWith('warn', 'Queue presentation failed', expect.anything())
})
