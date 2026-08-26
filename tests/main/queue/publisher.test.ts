import { describe, expect, it, vi } from 'vitest'

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
vi.mock('../../../src/main/queue/queue-manager', () => ({
  queueManager: { getAllStoredTasks: () => mocks.tasks },
}))

const {
  publishQueueControlState,
  publishQueueState,
  subscribeQueueControlState,
} = await import('../../../src/main/queue/publisher')

describe('queue control publication', () => {
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
    expect(mocks.send).toHaveBeenCalledWith('queue:updated', mocks.tasks)
    expect(mocks.send).toHaveBeenCalledWith('queue:controlState', mocks.state)
    expect(mocks.refreshMinimum).toHaveBeenCalled()
  })
})
