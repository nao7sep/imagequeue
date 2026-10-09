import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecordsReaderRequest } from '../../src/main/records-reader'

const mocks = vi.hoisted(() => ({ create: vi.fn(), databasePath: '/disposable/records.sqlite3' as string | null }))
vi.mock('../../src/main/records-reader-worker?nodeWorker', () => ({ default: mocks.create }))
vi.mock('../../src/main/records', () => ({ flushRecords: async () => {}, recordsDatabasePath: () => mocks.databasePath }))
import { RECORDS_READ_TIMEOUT_MS, closeRecordsReader, readRecords } from '../../src/main/records-reader'

type FakeWorker = EventEmitter & {
  posted: RecordsReaderRequest[]
  postMessage: (message: RecordsReaderRequest) => void
  terminate: ReturnType<typeof vi.fn>
  unref: ReturnType<typeof vi.fn>
}

function fakeWorker(): FakeWorker {
  const worker = Object.assign(new EventEmitter(), {
    posted: [] as RecordsReaderRequest[],
    terminate: vi.fn().mockResolvedValue(0),
    unref: vi.fn(),
  }) as FakeWorker
  worker.postMessage = (message) => { worker.posted.push(message) }
  return worker
}

const PAGE = { records: [], more: false }

beforeEach(() => {
  mocks.databasePath = '/disposable/records.sqlite3'
})

afterEach(async () => {
  vi.useRealTimers()
  await closeRecordsReader()
  mocks.create.mockReset()
})

describe('records reader', () => {
  it('reads on one worker opened on the records database, answering each read by its id', async () => {
    const worker = fakeWorker()
    mocks.create.mockReturnValue(worker)
    const first = readRecords({ op: 'sources' })
    const second = readRecords({ op: 'page', query: { launch: null, session: null, kind: null, level: null, search: '', after: null } })

    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.create).toHaveBeenCalledOnce()
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.create).toHaveBeenCalledWith({ workerData: { databasePath: '/disposable/records.sqlite3' } })
    expect(worker.unref).toHaveBeenCalled()
    const [a, b] = worker.posted
    worker.emit('message', { id: b!.id, ok: true, value: PAGE })
    worker.emit('message', { id: a!.id, ok: false, error: 'Error: no such table: ai_calls' })

    await expect(second).resolves.toEqual(PAGE)
    await expect(first).rejects.toThrow('no such table')
  })

  it('ends a worker whose read outlasts its bound, and starts a fresh one for the next read', async () => {
    vi.useFakeTimers()
    const stalled = fakeWorker()
    const fresh = fakeWorker()
    mocks.create.mockReturnValueOnce(stalled).mockReturnValueOnce(fresh)
    const read = readRecords({ op: 'sources' })
    const failed = expect(read).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(RECORDS_READ_TIMEOUT_MS)
    await failed
    expect(stalled.terminate).toHaveBeenCalledOnce()

    const next = readRecords({ op: 'sources' })
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.create).toHaveBeenCalledTimes(2)
    fresh.emit('message', { id: fresh.posted[0]!.id, ok: true, value: { launches: [], sessions: [] } })
    await expect(next).resolves.toEqual({ launches: [], sessions: [] })
    // A late answer from the ended worker changes nothing.
    stalled.emit('message', { id: 1, ok: true, value: PAGE })
  })

  it('waits for native termination before replacement, even across another read deadline and close', async () => {
    vi.useFakeTimers()
    const stalled = fakeWorker()
    const fresh = fakeWorker()
    let finishTermination!: () => void
    stalled.terminate.mockReturnValue(new Promise<number>((resolve) => { finishTermination = () => resolve(0) }))
    mocks.create.mockReturnValueOnce(stalled).mockReturnValueOnce(fresh)
    try {
      const first = readRecords({ op: 'sources' })
      const firstFailed = expect(first).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(RECORDS_READ_TIMEOUT_MS)
      await firstFailed
      expect(stalled.terminate).toHaveBeenCalledOnce()

      const second = readRecords({ op: 'sources' })
      const secondFailed = expect(second).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(RECORDS_READ_TIMEOUT_MS)
      await secondFailed
      expect(mocks.create).toHaveBeenCalledOnce()
      expect(stalled.terminate).toHaveBeenCalledOnce()

      const third = readRecords({ op: 'sources' })
      const thirdFailed = expect(third).rejects.toThrow('closed')
      const closing = closeRecordsReader()
      await thirdFailed
      let closed = false
      void closing.then(() => { closed = true })
      await vi.advanceTimersByTimeAsync(RECORDS_READ_TIMEOUT_MS)
      expect(closed).toBe(false)
      expect(mocks.create).toHaveBeenCalledOnce()

      finishTermination()
      await closing
      await vi.advanceTimersByTimeAsync(0)
      // Timed-out and closed reads must not become late replacement requests.
      expect(mocks.create).toHaveBeenCalledOnce()
      const next = readRecords({ op: 'sources' })
      await vi.advanceTimersByTimeAsync(0)
      expect(mocks.create).toHaveBeenCalledTimes(2)
      fresh.emit('message', { id: fresh.posted[0]!.id, ok: true, value: { launches: [], sessions: [] } })
      await expect(next).resolves.toEqual({ launches: [], sessions: [] })
    } finally {
      finishTermination()
    }
  })

  it('fails the reads waiting on a worker that stops', async () => {
    const worker = fakeWorker()
    mocks.create.mockReturnValue(worker)
    const read = readRecords({ op: 'sources' })
    await Promise.resolve()
    await Promise.resolve()
    worker.emit('exit', 1)
    await expect(read).rejects.toThrow('exited')
  })

  it('refuses to read while the records database is not open', async () => {
    mocks.databasePath = null
    await expect(readRecords({ op: 'sources' })).rejects.toThrow('not open')
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('owns termination through settlement, failing any read still waiting', async () => {
    vi.useFakeTimers()
    const worker = fakeWorker()
    let stop!: () => void
    worker.terminate.mockReturnValue(new Promise<number>((resolve) => { stop = () => resolve(0) }))
    mocks.create.mockReturnValue(worker)
    const read = readRecords({ op: 'sources' })
    const failed = expect(read).rejects.toThrow('closed')
    await Promise.resolve()
    await Promise.resolve()
    const closing = closeRecordsReader()
    await failed
    expect(worker.terminate).toHaveBeenCalledOnce()
    let settled = false
    void closing.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(settled).toBe(false)
    stop()
    await closing
  })
})
