import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../../src/main/records-writer-worker?nodeWorker', () => ({ default: mock.create }))
import { closeRecords, flushRecords, openRecords, setRecordsSession, startCliJobRecord } from '../../src/main/records'

const roots: string[] = []
afterEach(async () => {
  await closeRecords()
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

it('captures the stream root, session, writer and actual end time before asynchronous sink settlement', async () => {
  const messages: Array<Array<{ type: string; id?: number; row?: Record<string, unknown> }>> = []
  mock.create.mockImplementation(() => {
    const posted: typeof messages[number] = []
    messages.push(posted)
    const worker = Object.assign(new EventEmitter(), {
      unref: vi.fn(),
      postMessage: (message: typeof posted[number]) => {
        posted.push(message)
        if (message.type === 'flush') worker.emit('message', { type: 'flushed', id: message.id })
        if (message.type === 'close') worker.emit('exit', 0)
      },
    })
    return worker
  })
  for (let index = 0; index < 2; index++) roots.push(fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-cli-owner-')))
  openRecords(roots[0])
  setRecordsSession('first-session')
  const record = startCliJobRecord({ jobId: 'owned', kind: 'download', target: 'm', cliPath: '/cli', args: [] })
  record.append('stdout', 'actual bytes\r\n', () => {})
  const firstEnd = new Date().toISOString()
  record.finish({ startedAt: null, status: 'exited', exitCode: 0, signal: null })
  const lastEnd = new Date().toISOString()
  openRecords(roots[1])
  setRecordsSession('replacement-session')
  await flushRecords()
  const row = messages[0].find((message) => message.type === 'write')!.row!
  expect(row.session_id).toBe('first-session')
  expect(String(row.ended_at) >= firstEnd && String(row.ended_at) <= lastEnd).toBe(true)
  expect(fs.readFileSync(path.join(roots[0], 'cli-output', row.stdout_file as string), 'utf8')).toBe('actual bytes\r\n')
  expect(fs.existsSync(path.join(roots[1], 'cli-output'))).toBe(false)
  expect(messages[0].at(-1)!.type).toBe('close')
  expect(messages[1].every((message) => message.type !== 'write')).toBe(true)
})
