import { afterAll, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import path from 'path'
import { writeLogRecord } from '../../src/main/records'
import type { RecordsReaderResponse } from '../../src/main/records-reader'
import { freshRecordsRoot, removeRecordsRoots } from './records-fixture'

const dir = freshRecordsRoot()
writeLogRecord('2026-01-01T00:00:00.000Z', 'info', 'Read on the worker', {})

const port = vi.hoisted(() => ({ databasePath: '', posted: [] as unknown[], emitter: null as EventEmitter | null }))
port.databasePath = path.join(dir, 'records.sqlite3')

vi.mock('node:worker_threads', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  const emitter = new Emitter()
  port.emitter = emitter
  return {
    parentPort: Object.assign(emitter, { postMessage: (message: unknown) => port.posted.push(message) }),
    get workerData() { return { databasePath: port.databasePath } },
  }
})

await import('../../src/main/records-reader-worker')

afterAll(() => {
  removeRecordsRoots()
})

const ask = (message: unknown): RecordsReaderResponse => {
  port.emitter!.emit('message', message)
  return port.posted.at(-1) as RecordsReaderResponse
}

describe('records reader worker', () => {
  it('answers a read from its own read-only connection', () => {
    const answer = ask({ id: 7, read: { op: 'sources' } })
    expect(answer).toMatchObject({ id: 7, ok: true, value: { sessions: [] } })
    const page = ask({ id: 8, read: { op: 'page', query: { launch: null, session: null, kind: 'log', level: null, search: '', after: null } } })
    expect(page.ok && (page.value as { records: { title: string }[] }).records.map((record) => record.title)).toEqual(['Read on the worker'])
  })

  it('reports a failed read by its id, and answers the next read afresh', () => {
    const failed = ask({ id: 9, read: { op: 'page', query: { launch: null, session: null, kind: null, level: null, search: 5, after: null } } })
    expect(failed).toMatchObject({ id: 9, ok: false, error: expect.stringContaining('TypeError') })
    expect(ask({ id: 10, read: { op: 'detail', kind: 'log', id: 99_999 } })).toEqual({ id: 10, ok: true, value: null })
  })
})
