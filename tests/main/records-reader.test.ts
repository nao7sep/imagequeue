import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecordsReaderRequest } from '../../src/main/records-reader'

const mocks = vi.hoisted(() => ({ create: vi.fn(), writeLogRecord: vi.fn(), databasePath: '/disposable/records.sqlite3' as string | null }))
vi.mock('../../src/main/records-reader-worker?nodeWorker', () => ({ default: mocks.create }))
vi.mock('../../src/main/records', () => ({ flushRecords: async () => {}, writeLogRecord: mocks.writeLogRecord, recordsDatabasePath: () => mocks.databasePath }))
import { closeRecordsReader, readRecords } from '../../src/main/records-reader'

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

  it('fails the reads waiting on a worker that stops', async () => {
    const worker = fakeWorker()
    mocks.create.mockReturnValue(worker)
    const read = readRecords({ op: 'sources' })
    await Promise.resolve()
    await Promise.resolve()
    worker.emit('exit', 1)
    await expect(read).rejects.toThrow('exited')
  })

  it('starts a new worker for the next read after one errors', async () => {
    const failed = fakeWorker()
    const fresh = fakeWorker()
    mocks.create.mockReturnValueOnce(failed).mockReturnValueOnce(fresh)
    const read = readRecords({ op: 'sources' })
    await Promise.resolve()
    await Promise.resolve()
    failed.emit('error', new Error('native crash'))
    await expect(read).rejects.toThrow('native crash')

    const next = readRecords({ op: 'sources' })
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.create).toHaveBeenCalledTimes(2)
    // The failed worker's later exit does not fail the new worker's read.
    failed.emit('exit', 1)
    fresh.emit('message', { id: fresh.posted[0]!.id, ok: true, value: { launches: [], sessions: [] } })
    await expect(next).resolves.toEqual({ launches: [], sessions: [] })
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

it('records a partial search warning without rejecting its intact matches', async () => {
  const worker = fakeWorker()
  mocks.create.mockReturnValue(worker)
  const result = readRecords({ op: 'page', query: { launch: null, session: null, kind: null, level: null, search: 'needle', after: null } })
  await Promise.resolve()
  await Promise.resolve()
  const warning = { unavailableInputs: 2, first: { jobId: 8, stream: 'stdout', reference: 'retained.log',
    error: { name: 'Error', code: 'EACCES', message: '/private/SENTINEL', stack: 'complete stack' } } }
  const page = { ...PAGE, searchIncomplete: true }
  worker.emit('message', { id: worker.posted[0]!.id, ok: true, value: page, warning })
  await expect(result).resolves.toEqual(page)
  expect(mocks.writeLogRecord).toHaveBeenCalledWith(expect.any(String), 'warn', 'CLI output search was incomplete', warning)
})
