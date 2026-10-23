import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../../src/main/records-writer-worker?nodeWorker', () => ({ default: mocks.create }))
import {
  closeRecords, flushRecords, openRecords, setRecordsSession,
  startAiCall, startCliJobRecord, writeLogRecord,
} from '../../src/main/records'

type Message = { type: string; id?: number; recordId?: number; table?: string; row?: Record<string, unknown> }
const gapMessage = 'Diagnostic records were dropped while the writer was backed up'
const oversized = 'x'.repeat(17 * 1024 * 1024)

function createWorker() {
  const posted: Message[] = []
  const worker = Object.assign(new EventEmitter(), {
    postMessage: (message: Message) => {
      posted.push(message)
      if (message.type === 'close') worker.emit('exit', 0)
    },
    unref: vi.fn(),
  })
  mocks.create.mockReturnValueOnce(worker)
  return {
    worker, posted,
    acknowledge: (message: Message) => worker.emit('message', { type: 'written', recordId: message.recordId }),
    flush: (message: Message) => worker.emit('message', { type: 'flushed', id: message.id }),
  }
}

function writeOversized(message = 'large') {
  writeLogRecord('time', 'info', message, { payload: oversized })
}

afterEach(async () => {
  await closeRecords()
  vi.useRealTimers()
  vi.restoreAllMocks()
  mocks.create.mockReset()
})

it('admits an oversized diagnostic record whole when the mailbox is empty', () => {
  const { posted } = createWorker()
  openRecords('/disposable')
  writeOversized()
  expect(posted).toHaveLength(1)
  expect(posted[0]).toMatchObject({ type: 'write', table: 'log_records', row: { message: 'large' } })
  expect(JSON.parse(posted[0].row!.fields as string)).toEqual({ payload: oversized })
})

it('summarizes repeated drops across sessions and tables only after all admitted records settle', () => {
  vi.useFakeTimers()
  const firstDroppedAt = '2026-10-24T01:00:00.000Z'
  const lastDroppedAt = '2026-10-24T01:01:00.000Z'
  vi.setSystemTime(firstDroppedAt)
  const { posted, acknowledge } = createWorker()
  const warning = vi.spyOn(console, 'error').mockImplementation(() => {})
  openRecords('/disposable')
  const admitted = 'a'.repeat(7 * 1024 * 1024)
  writeLogRecord('time', 'info', 'admitted first', { payload: admitted })
  writeLogRecord('time', 'info', 'admitted second', { payload: admitted })
  const dropped = 'private-dropped-payload'.repeat(150_000)
  setRecordsSession('first-session')
  for (let i = 0; i < 3; i++) writeLogRecord('time', 'info', `dropped ${i}`, { payload: dropped })
  setRecordsSession('second-session')
  startAiCall({ backend: 'test', model: 'test', purpose: 'test', request: dropped }).finish({})
  vi.setSystemTime(lastDroppedAt)
  startCliJobRecord({ jobId: 'job', kind: 'test', target: 'test', cliPath: 'test', args: [] })
    .finish({ startedAt: null, status: 'failed', exitCode: 1, signal: null, stdout: dropped })
  expect(posted).toHaveLength(2)
  expect(warning).toHaveBeenCalledOnce()
  acknowledge(posted[0])
  expect(posted).toHaveLength(2)
  acknowledge(posted[1])
  expect(posted).toHaveLength(3)
  const summary = posted[2]
  expect(summary).toMatchObject({
    type: 'write', table: 'log_records', row: { level: 'warn', message: gapMessage, session_id: null },
  })
  expect(JSON.parse(summary.row!.fields as string)).toEqual({
    count: 5, firstDroppedAt, lastDroppedAt,
    tables: { log_records: 3, ai_calls: 1, cli_jobs: 1 },
  })
  expect(JSON.stringify(summary).length).toBeLessThan(1000)
  expect(JSON.stringify(summary)).not.toContain('private-dropped-payload')
  acknowledge(summary)
  writeLogRecord('time', 'info', 'resumed', {})
  expect(posted[3].row?.message).toBe('resumed')
})

it('emits one console warning and one retained summary for each overflow interval', () => {
  const { posted, acknowledge } = createWorker()
  const warning = vi.spyOn(console, 'error').mockImplementation(() => {})
  openRecords('/disposable')
  writeOversized('first backlog')
  writeLogRecord('time', 'info', 'first drop', {})
  writeLogRecord('time', 'info', 'second drop', {})
  expect(warning).toHaveBeenCalledOnce()
  acknowledge(posted[0])
  expect(JSON.parse(posted[1].row!.fields as string).count).toBe(2)
  acknowledge(posted[1])
  writeOversized('second backlog')
  writeLogRecord('time', 'info', 'third drop', {})
  expect(warning).toHaveBeenCalledTimes(2)
  acknowledge(posted[2])
  expect(posted[3].row?.message).toBe(gapMessage)
  expect(JSON.parse(posted[3].row!.fields as string).count).toBe(1)
  acknowledge(posted[3])
  expect(posted.filter((message) => message.row?.message === gapMessage)).toHaveLength(2)
})

it('waits for a second flush barrier when backlog acknowledgement queues the summary behind the first', async () => {
  const { posted, acknowledge, flush } = createWorker()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  openRecords('/disposable')
  writeOversized()
  writeLogRecord('time', 'info', 'dropped', {})
  let settled = false
  const flushed = flushRecords().then(() => { settled = true })
  expect(posted.map((message) => message.type)).toEqual(['write', 'flush'])
  acknowledge(posted[0])
  expect(posted[2].row?.message).toBe(gapMessage)
  flush(posted[1])
  await Promise.resolve()
  expect(settled).toBe(false)
  expect(posted.map((message) => message.type)).toEqual(['write', 'flush', 'write', 'flush'])
  acknowledge(posted[2])
  flush(posted[3])
  await flushed
  expect(settled).toBe(true)
})

it('queues one gap summary before closing even while the admitted backlog is stalled', async () => {
  const { posted, acknowledge } = createWorker()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  openRecords('/disposable')
  writeOversized()
  writeLogRecord('time', 'info', 'dropped', {})
  await closeRecords()
  expect(posted.map((message) => message.type)).toEqual(['write', 'write', 'close'])
  expect(posted[1].row?.message).toBe(gapMessage)
  expect(JSON.parse(posted[1].row!.fields as string).count).toBe(1)
  acknowledge(posted[0])
  acknowledge(posted[1])
  expect(posted).toHaveLength(3)
})

it('isolates a replacement writer from the retired writer acknowledgements, budget and gap', () => {
  const old = createWorker()
  const replacement = createWorker()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  openRecords('/old-disposable')
  writeOversized('old backlog')
  writeLogRecord('time', 'info', 'old drop', {})
  openRecords('/new-disposable')
  expect(old.posted.map((message) => message.type)).toEqual(['write', 'write', 'close'])
  expect(JSON.parse(old.posted[1].row!.fields as string).count).toBe(1)
  writeOversized('new backlog')
  expect(replacement.posted).toHaveLength(1)
  old.acknowledge(old.posted[0])
  old.acknowledge(old.posted[1])
  writeLogRecord('time', 'info', 'new drop', {})
  expect(replacement.posted).toHaveLength(1)
  replacement.acknowledge(replacement.posted[0])
  expect(replacement.posted).toHaveLength(2)
  expect(replacement.posted[1].row?.message).toBe(gapMessage)
  expect(JSON.parse(replacement.posted[1].row!.fields as string).count).toBe(1)
  expect(old.posted).toHaveLength(3)
})

it('settles a pending flush if the writer exits after queuing its gap warning', async () => {
  const { worker, posted, acknowledge } = createWorker()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  openRecords('/disposable')
  writeOversized()
  writeLogRecord('time', 'info', 'dropped', {})
  const flushed = flushRecords()
  acknowledge(posted[0])
  expect(posted[2].row?.message).toBe(gapMessage)
  worker.emit('exit', 1)
  await flushed
  expect(posted.map((message) => message.type)).toEqual(['write', 'flush', 'write'])
})
