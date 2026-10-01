import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn(), log: vi.fn(), clear: vi.fn(async () => undefined) }))
vi.mock('../../../src/main/backup/archive-worker?nodeWorker', () => ({ default: mocks.create }))
vi.mock('../../../src/main/config', () => ({ getDataDir: () => '/disposable/imagequeue' }))
vi.mock('../../../src/main/backup/archive-engine', () => ({ clearAbandonedRun: mocks.clear }))
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
  it('clears what the run left once the worker its deadline ended has stopped', async () => {
    vi.useFakeTimers()
    let stop!: () => void
    const running = Object.assign(new EventEmitter(), { terminate: vi.fn(() => new Promise<number>((resolve) => { stop = () => resolve(1) })) })
    mocks.create.mockReturnValue(running)
    const pending = archiveSession('finish')
    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.clear).not.toHaveBeenCalled()
    stop()
    await vi.advanceTimersByTimeAsync(0)
    await pending
    expect(mocks.clear).toHaveBeenCalledWith('/disposable/imagequeue')
  })
  it('gives up on a worker that does not stop, within a bound', async () => {
    vi.useFakeTimers()
    const running = Object.assign(new EventEmitter(), { terminate: vi.fn(() => new Promise<number>(() => undefined)) })
    mocks.create.mockReturnValue(running)
    const pending = archiveSession('finish')
    await vi.advanceTimersByTimeAsync(6000)
    await pending
    expect(mocks.clear).not.toHaveBeenCalled()
    expect(mocks.log).toHaveBeenLastCalledWith('warn', 'Archive cleanup did not finish in time')
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
    expect(mocks.clear).not.toHaveBeenCalled()
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
