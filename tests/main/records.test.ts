import { afterAll, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { closeRecords, fetchRecorded, onRecordStored, openRecords, recordAiCall, recordsDatabasePath, setRecordsSession, startAiCall, startCliJobRecord, writeLogRecord } from '../../src/main/records'
import { freshRecordsRoot, readLog, readRows, removeRecordsRoots } from './records-fixture'
import { FORMAT_VERSIONS } from '../../src/main/store-format'

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
  // Nothing is cut (data-lifecycle-conventions): the request is kept as it was
  // sent, its headers and the key they carry included.
  it('keep a request whole, its headers included', async () => {
    const dir = freshRecordsRoot()
    const request = { url: 'https://api.example/flux', headers: { 'x-key': 'test-key', Authorization: 'Bearer test-token' }, body: { prompt: 'a fox' } }
    await recordAiCall({ backend: 'flux', model: 'flux-2-pro', purpose: 'image', request }, async () => ({ ok: true }))

    const [row] = readRows(dir, 'ai_calls')
    expect(JSON.parse(row!.request as string)).toEqual(request)
  })

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

describe('CLI job records', () => {
  const job = {
    jobId: 'job-1', kind: 'download', target: 'model.ckpt', cliPath: '/bin/draw-things-cli',
    args: ['models', 'ensure', '--model', 'model.ckpt'],
  }

  it('hold the command, the session when it was asked for, how it ended and its output as received', () => {
    const dir = freshRecordsRoot()
    setRecordsSession('s1')
    const record = startCliJobRecord(job)
    setRecordsSession('s2')
    record.finish({
      startedAt: '2026-01-01T00:00:01.000Z', status: 'exited', exitCode: 0, signal: null,
      stdout: '10%\r100%\r\nDone\n', stderr: '',
    })
    record.finish({ startedAt: null, status: 'killed', exitCode: null, signal: 'SIGTERM', stdout: '', stderr: '' })

    const rows = readRows(dir, 'cli_jobs')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      session_id: 's1', job_id: 'job-1', job_kind: 'download', target: 'model.ckpt', cli_path: '/bin/draw-things-cli',
      started_at: '2026-01-01T00:00:01.000Z', status: 'exited', exit_code: 0, signal: null,
      stdout: '10%\r100%\r\nDone\n', stderr: '', error: null,
    })
    expect(JSON.parse(rows[0]!.args as string)).toEqual(job.args)
    expect(rows[0]!.ended_at).toEqual(expect.stringMatching(/Z$/))
  })

  it('keep the error the process runner reported', () => {
    const dir = freshRecordsRoot()
    startCliJobRecord(job).finish({
      startedAt: '2026-01-01T00:00:01.000Z', status: 'exited', exitCode: null, signal: null, stdout: '', stderr: '',
      error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }),
    })
    expect(JSON.parse(readRows(dir, 'cli_jobs')[0]!.error as string)).toMatchObject({ message: 'spawn ENOENT', code: 'ENOENT' })
  })

  it('fall back with their arguments inline when the write fails', () => {
    const dir = freshRecordsRoot()
    const other = new DatabaseSync(path.join(dir, 'records.sqlite3'))
    other.exec('DROP TABLE cli_jobs')
    other.close()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    startCliJobRecord(job).finish({ startedAt: null, status: 'killed', exitCode: null, signal: null, stdout: 'out', stderr: '' })
    consoleError.mockRestore()

    expect(fallbackLines(dir).at(-1)).toMatchObject({ table: 'cli_jobs', job_id: 'job-1', args: job.args, stdout: 'out' })
  })
})

describe('the stored-record signal', () => {
  it('follows each record the database stored, and no record kept in the fallback file', () => {
    const dir = freshRecordsRoot()
    const stored = vi.fn()
    onRecordStored(stored)
    writeLogRecord('2026-01-01T00:00:00.000Z', 'info', 'Stored', {})
    startAiCall({ backend: 'openai', model: 'm', purpose: 'image', request: {} }).finish({})
    expect(stored).toHaveBeenCalledTimes(2)

    const other = new DatabaseSync(path.join(dir, 'records.sqlite3'))
    other.exec('DROP TABLE log_records')
    other.close()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    writeLogRecord('2026-01-01T00:00:01.000Z', 'info', 'Kept in the fallback file', {})
    consoleError.mockRestore()
    expect(stored).toHaveBeenCalledTimes(2)
    onRecordStored(null)
  })

  it('never lets a failing listener lose the record or reach the caller', () => {
    const dir = freshRecordsRoot()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    onRecordStored(() => { throw new Error('window gone') })
    expect(() => writeLogRecord('2026-01-01T00:00:00.000Z', 'info', 'Still stored', {})).not.toThrow()
    onRecordStored(null)
    consoleError.mockRestore()
    expect(readLog(dir).map((row) => row.message)).toEqual(['Still stored'])
  })

  it('names the open database for the reader, and none once closed', () => {
    const dir = freshRecordsRoot()
    expect(recordsDatabasePath()).toBe(path.join(dir, 'records.sqlite3'))
    closeRecords()
    expect(recordsDatabasePath()).toBeNull()
  })
})

describe('the records format version', () => {
  function userVersion(file: string): number {
    const db = new DatabaseSync(file, { readOnly: true })
    try {
      return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    } finally {
      db.close()
    }
  }

  it('keeps records in the fallback file beside a database with no format version, and leaves its bytes as they were', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-records-unversioned-'))
    const file = path.join(dir, 'records.sqlite3')
    const seeded = new DatabaseSync(file)
    seeded.exec('CREATE TABLE kept (value TEXT)')
    seeded.close()
    const bytes = fs.readFileSync(file)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    openRecords(dir)
    writeLogRecord('2026-01-01T00:00:00.000Z', 'info', 'Kept anyway', {})
    consoleError.mockRestore()

    expect(recordsDatabasePath()).toBeNull()
    expect(fallbackLines(dir).map((line) => line.message)).toEqual(['Records database could not be opened', 'Kept anyway'])
    expect(fs.readFileSync(file).equals(bytes)).toBe(true)
    closeRecords()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('writes its version and reads it back on the next open', () => {
    const dir = freshRecordsRoot()
    closeRecords()
    expect(userVersion(path.join(dir, 'records.sqlite3'))).toBe(FORMAT_VERSIONS.records)
    openRecords(dir)
    expect(recordsDatabasePath()).toBe(path.join(dir, 'records.sqlite3'))
    closeRecords()
  })

  it('keeps records in the fallback file beside a database from a newer version, and leaves its bytes as they were', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-records-newer-'))
    const file = path.join(dir, 'records.sqlite3')
    const seeded = new DatabaseSync(file)
    seeded.exec(`CREATE TABLE kept (value TEXT); PRAGMA user_version = ${FORMAT_VERSIONS.records + 1}`)
    seeded.close()
    const bytes = fs.readFileSync(file)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    openRecords(dir)
    writeLogRecord('2026-01-01T00:00:00.000Z', 'info', 'Kept anyway', {})
    consoleError.mockRestore()

    expect(recordsDatabasePath()).toBeNull()
    expect(fallbackLines(dir).map((line) => line.message)).toEqual(['Records database could not be opened', 'Kept anyway'])
    expect(fs.readFileSync(file).equals(bytes)).toBe(true)
    closeRecords()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
