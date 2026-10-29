import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setPaused: vi.fn(),
  publish: vi.fn(),
  schedule: vi.fn(),
}))

vi.mock('../../../src/main/backends/cancellation', () => ({ setQueuePaused: mocks.setPaused }))
vi.mock('../../../src/main/queue/publisher', () => ({ publishQueueControlState: mocks.publish }))
vi.mock('../../../src/main/backends/processor', () => ({ processQueues: mocks.schedule }))

const { setQueuePausedAndPublish } = await import('../../../src/main/queue/control-actions')

describe('setQueuePausedAndPublish', () => {
  it('mutates the sole pause flag before publishing its derived state', () => {
    const order: string[] = []
    mocks.setPaused.mockImplementation(() => { order.push('mutate') })
    mocks.publish.mockImplementation(() => { order.push('publish') })

    setQueuePausedAndPublish(true)

    expect(mocks.setPaused).toHaveBeenCalledWith(true)
    expect(order).toEqual(['mutate', 'publish'])
    expect(mocks.schedule).not.toHaveBeenCalled()
  })

  // Resuming is a command after which the session starts what it now allows.
  it('starts queued work once the queue resumes', () => {
    const order: string[] = []
    mocks.setPaused.mockImplementation(() => { order.push('mutate') })
    mocks.publish.mockImplementation(() => { order.push('publish') })
    mocks.schedule.mockImplementation(() => { order.push('schedule') })

    setQueuePausedAndPublish(false)

    expect(order).toEqual(['mutate', 'publish', 'schedule'])
  })
})
