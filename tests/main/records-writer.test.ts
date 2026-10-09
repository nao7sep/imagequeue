import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../../src/main/records-writer-worker?nodeWorker', () => ({ default: mocks.create }))
import { closeRecords, flushRecords, openRecords, writeLogRecord } from '../../src/main/records'

afterEach(() => { vi.restoreAllMocks(); mocks.create.mockReset() })
it('bounds a stalled diagnostic mailbox, keeps an oversized record whole, and resumes after settlement', async () => {
  type Message = { type: string; id?: number; recordId?: number; row?: Record<string, unknown> }
  const posted: Message[] = []
  const worker = Object.assign(new EventEmitter(), {
    postMessage: (message: Message) => {
      posted.push(message)
      if (message.type === 'close') worker.emit('exit', 0)
    },
    unref: vi.fn(),
  })
  mocks.create.mockReturnValue(worker)
  const warning = vi.spyOn(console, 'error').mockImplementation(() => {})
  openRecords('/disposable')
  const large = 'x'.repeat(17 * 1024 * 1024)
  writeLogRecord('time', 'info', 'large', { payload: large })
  writeLogRecord('time', 'info', 'overflow 1', {})
  writeLogRecord('time', 'info', 'overflow 2', {})
  expect(posted).toHaveLength(1)
  expect(JSON.parse(posted[0].row!.fields as string).payload).toBe(large)
  expect(warning).toHaveBeenCalledOnce()
  worker.emit('message', { type: 'written', recordId: posted[0].recordId })
  writeLogRecord('time', 'info', 'resumed', {})
  expect(posted[1].row?.message).toBe('resumed')
  const flushed = flushRecords()
  worker.emit('message', { type: 'written', recordId: posted[1].recordId })
  worker.emit('message', { type: 'flushed', id: posted[2].id })
  await flushed
  await closeRecords()
})
