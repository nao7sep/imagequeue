import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn(), log: vi.fn() }))
vi.mock('../../../src/main/backup/archive-worker?nodeWorker', () => ({ default: mocks.create }))
vi.mock('../../../src/main/config', () => ({ getDataDir: () => '/disposable/imagequeue' }))
vi.mock('../../../src/main/logger', () => ({ log: mocks.log, serializeError: (error: Error) => ({ message: error.message }) }))
import { archiveSession } from '../../../src/main/backup/archive'

function worker(): EventEmitter & { terminate: ReturnType<typeof vi.fn> } {
  return Object.assign(new EventEmitter(), { terminate: vi.fn().mockResolvedValue(0) })
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('bounded archive owner', () => {
  it('terminates a stalled worker at its deadline and logs once', async () => {
    vi.useFakeTimers()
    const running = worker()
    mocks.create.mockReturnValue(running)
    const pending = archiveSession('finish')
    await vi.advanceTimersByTimeAsync(5000)
    await pending
    expect(running.terminate).toHaveBeenCalledOnce()
    expect(mocks.log).toHaveBeenCalledOnce()
  })
  it('finishes startup work before starting the exit archive', async () => {
    const beginWorker = worker()
    const finishWorker = worker()
    mocks.create.mockReturnValueOnce(beginWorker).mockReturnValueOnce(finishWorker)
    const begin = archiveSession('begin')
    const finish = archiveSession('finish')
    await Promise.resolve()
    expect(mocks.create).toHaveBeenCalledOnce()
    beginWorker.emit('message', { warnings: [] })
    await begin
    await Promise.resolve()
    expect(mocks.create).toHaveBeenCalledTimes(2)
    finishWorker.emit('message', { warnings: [] })
    await finish
    expect(beginWorker.terminate).toHaveBeenCalledOnce()
    expect(finishWorker.terminate).toHaveBeenCalledOnce()
    expect(mocks.log).not.toHaveBeenCalled()
  })
  it('reports an unexpected worker exit without delaying quit', async () => {
    const running = worker()
    mocks.create.mockReturnValue(running)
    const pending = archiveSession('finish')
    await Promise.resolve()
    running.emit('exit', 1)
    await pending
    expect(mocks.log).toHaveBeenCalledOnce()
  })
})
