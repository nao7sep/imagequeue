import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setPaused: vi.fn(),
  publish: vi.fn(),
}))

vi.mock('../../../src/main/backends/cancellation', () => ({ setQueuePaused: mocks.setPaused }))
vi.mock('../../../src/main/queue/publisher', () => ({ publishQueueControlState: mocks.publish }))

const { setQueuePausedAndPublish } = await import('../../../src/main/queue/control-actions')

describe('setQueuePausedAndPublish', () => {
  it('mutates the sole pause flag before publishing its derived state', () => {
    const order: string[] = []
    mocks.setPaused.mockImplementation(() => { order.push('mutate') })
    mocks.publish.mockImplementation(() => { order.push('publish') })

    setQueuePausedAndPublish(true)

    expect(mocks.setPaused).toHaveBeenCalledWith(true)
    expect(order).toEqual(['mutate', 'publish'])
  })
})
