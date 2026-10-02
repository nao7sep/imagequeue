import { afterAll, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { closeRecords, fetchRecorded, openRecords, recordAiCall, setRecordsSession, startAiCall, writeLogRecord } from '../../src/main/records'
import { freshRecordsRoot, readLog, readRows, removeRecordsRoots } from './records-fixture'

afterAll(() => {
  vi.unstubAllGlobals()
  removeRecordsRoots()
})

function fallbackLines(dir: string): Record<string, unknown>[] {
  const logs = path.join(dir, 'logs')
  return fs.readdirSync(logs).flatMap((name) => fs.readFileSync(path.join(logs, name), 'utf-8')
    .split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>))
}

describe('log records', () => {
  it('carry the launch, the open session and their task and request ids in columns', () => {
    const dir = freshRecordsRoot()
    setRecordsSession('20260101-000000-000-utc')
    writeLogRecord('2026-01-01T00:00:00.000Z', 'info', 'Task enqueued', { taskId: 't1', requestId: 'r1', count: 2 })
    writeLogRecord('2026-01-01T00:00:01.000Z', 'info', 'Odd id', { taskId: 7 })

    const [first, second] = readRows(dir, 'log_records')
    expect(first).toMatchObject({ session_id: '20260101-000000-000-utc', task_id: 't1', request_id: 'r1', level: 'info', message: 'Task enqueued' })
    expect(JSON.parse(first.fields as string)).toEqual({ count: 2 })
    expect(second.task_id).toBeNull()
    expect(JSON.parse(second.fields as string)).toEqual({ taskId: 7 })
  })

  it('fall back to the launch\'s text file under logs/ when the database cannot be opened', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-records-broken-'))
    fs.mkdirSync(path.join(dir, 'records.sqlite3'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    openRecords(dir)
    writeLogRecord('2026-01-01T00:00:00.000Z', 'info', 'Kept anyway', {})
    consoleError.mockRestore()
    closeRecords()

    const lines = fallbackLines(dir)
    expect(fs.readdirSync(path.join(dir, 'logs'))[0]).toMatch(/^\d{8}-\d{6}-\d{3}-utc\.log$/)
    expect(lines.map((line) => line.message)).toEqual(['Records database could not be opened', 'Kept anyway'])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('fall back for the one entry whose write fails', () => {
    const dir = freshRecordsRoot()
    const other = new DatabaseSync(path.join(dir, 'records.sqlite3'))
    other.exec('DROP TABLE log_records')
    other.close()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => writeLogRecord('2026-01-01T00:00:00.000Z', 'error', 'Not lost', { a: 1 })).not.toThrow()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()

    const kept = fallbackLines(dir).at(-1)!
    expect(kept).toMatchObject({ table: 'log_records', message: 'Not lost', fields: { a: 1 } })
  })
})

describe('AI call records', () => {
  it('hold the request, the kept response and the session, and an error when the call fails', async () => {
    const dir = freshRecordsRoot()
    setRecordsSession('s1')
    const call = { backend: 'openai', model: 'gpt-image-2', purpose: 'image', taskId: 't1', request: { prompt: 'a fox' } }
    await recordAiCall(call, async () => ({ data: [{ b64_json: 'BYTES', revised_prompt: 'a red fox' }] }),
      (answer) => ({ data: answer.data.map(({ b64_json: _bytes, ...rest }) => rest) }))
    await expect(recordAiCall(call, async () => { throw Object.assign(new Error('rate limited'), { status: 429 }) })).rejects.toThrow('rate limited')

    const [ok, failed] = readRows(dir, 'ai_calls')
    expect(ok).toMatchObject({ session_id: 's1', task_id: 't1', request_id: null, backend: 'openai', model: 'gpt-image-2', purpose: 'image', error: null })
    expect(JSON.parse(ok.request as string)).toEqual({ prompt: 'a fox' })
    expect(JSON.parse(ok.response as string)).toEqual({ data: [{ revised_prompt: 'a red fox' }] })
    expect(failed.response).toBeNull()
    expect(JSON.parse(failed.error as string)).toMatchObject({ message: 'rate limited', status: 429 })
  })

  it('record an HTTP answer with its status, headers and body', async () => {
    const dir = freshRecordsRoot()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"nope","b64":"x"}', { status: 400, headers: { 'x-request-id': 'abc' } })))
    const { response, text } = await fetchRecorded(
      { backend: 'grok', model: 'grok-imagine', purpose: 'image', request: { url: 'https://example.test' } },
      'https://example.test', {}, (parsed) => ({ error: (parsed as { error: string }).error }),
    )
    expect(response.status).toBe(400)
    expect(text).toBe('{"error":"nope","b64":"x"}')
    const row = readRows(dir, 'ai_calls').at(-1)!
    expect(JSON.parse(row.response as string)).toMatchObject({ status: 400, headers: { 'x-request-id': 'abc' }, body: { error: 'nope' } })
  })

  it('write a started call once', () => {
    const dir = freshRecordsRoot()
    const record = startAiCall({ backend: 'drawthings', model: 'm', purpose: 'image', request: { args: [] } })
    record.fail(new Error('spawn failed'))
    record.finish({ exitCode: 0 })
    expect(readRows(dir, 'ai_calls')).toHaveLength(1)
    expect(readLog(dir)).toHaveLength(0)
  })
})
