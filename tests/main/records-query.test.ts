import { afterAll, describe, expect, it } from 'vitest'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { currentRecordsContext, setRecordsSession, startAiCall, startCliJobRecord, writeLogRecord } from '../../src/main/records'
import { readDetail, readPage, readSources, runRecordsRead } from '../../src/main/records-query'
import { RECORDS_PAGE_SIZE, type RecordsQuery } from '../../src/shared/records'
import { freshRecordsRoot, removeRecordsRoots } from './records-fixture'

afterAll(() => {
  removeRecordsRoots()
})

const query = (overrides: Partial<RecordsQuery> = {}): RecordsQuery => ({
  launch: null, session: null, kind: null, level: null, search: '', after: null, ...overrides,
})

function open(dir: string): DatabaseSync {
  return new DatabaseSync(path.join(dir, 'records.sqlite3'), { readOnly: true })
}

// An earlier launch's line, written the way that launch would have.
function writeEarlierLaunch(dir: string, time: string, message: string): void {
  const db = new DatabaseSync(path.join(dir, 'records.sqlite3'))
  db.prepare(`INSERT INTO log_records (time, launch, session_id, task_id, request_id, level, message, fields)
    VALUES (?, '2026-01-01T00:00:00.000Z', 'old-session', NULL, NULL, 'info', ?, '{}')`).run(time, message)
  db.close()
}

function seed(): string {
  const dir = freshRecordsRoot()
  setRecordsSession('20260102-000000-000-utc')
  writeLogRecord('2026-01-02T00:00:01.000Z', 'info', 'Task enqueued', { taskId: 't1', prompt: 'a fox' })
  writeLogRecord('2026-01-02T00:00:02.000Z', 'warn', 'Careful', { note: '50%_off' })
  const ok = startAiCall({ backend: 'openai', model: 'gpt-image-2', purpose: 'image', taskId: 't1', request: { prompt: 'a fox' } })
  ok.finish({ data: [] })
  const failed = startAiCall({ backend: 'gemini', model: 'gemini-x', purpose: 'brainstorm', requestId: 'r1', request: { seed: 'fox' } })
  failed.fail(new Error('quota'))
  writeLogRecord('2026-01-02T00:00:03.000Z', 'error', 'Generation failed', { taskId: 't1' })
  writeEarlierLaunch(dir, '2026-01-01T00:00:05.000Z', 'Earlier launch')
  return dir
}

// One CLI job of each ending: exited with 0, stopped, and exited with 1.
function seedJobs(): string {
  const dir = freshRecordsRoot()
  setRecordsSession('20260103-000000-000-utc')
  const job = (jobId: string, target: string) =>
    startCliJobRecord({ jobId, kind: 'download', target, cliPath: '/bin/draw-things-cli', args: ['models', 'ensure', '--model', target] })
  const end = { startedAt: '2026-01-03T00:00:00.000Z', signal: null, stderr: '' }
  job('j-ok', 'ok.ckpt').finish({ ...end, status: 'exited', exitCode: 0, stdout: 'Downloaded 100%\n' })
  job('j-stopped', 'stopped.ckpt').finish({ ...end, status: 'killed', exitCode: null, signal: 'SIGTERM', stdout: '' })
  job('j-failed', 'failed.ckpt').finish({ ...end, status: 'exited', exitCode: 1, stdout: '', stderr: 'checksum mismatch\n' })
  writeLogRecord('2026-01-03T00:00:01.000Z', 'info', 'CLI job finished', { jobId: 'j-ok' })
  return dir
}

describe('records page', () => {
  it('lists both kinds newest first, a failed AI call reading as an error', () => {
    const dir = seed()
    const db = open(dir)
    const page = readPage(db, query())
    expect(page.more).toBe(false)
    const byTitle = Object.fromEntries(page.records.map((record) => [record.title, record]))
    expect(byTitle['openai image']).toMatchObject({ kind: 'ai-call', level: 'info', text: 'gpt-image-2' })
    expect(byTitle['gemini brainstorm']).toMatchObject({ kind: 'ai-call', level: 'error', text: 'gemini-x' })
    expect(byTitle['Careful']).toMatchObject({ kind: 'log', level: 'warn', text: null })
    expect(page.records.at(-1)!.title).toBe('Earlier launch')
    const times = page.records.map((record) => record.time)
    expect([...times].sort().reverse()).toEqual(times)
    db.close()
  })

  it('filters by launch, session, kind, level and search', () => {
    const dir = seed()
    const db = open(dir)
    const titles = (overrides: Partial<RecordsQuery>) => readPage(db, query(overrides)).records.map((record) => record.title).sort()
    expect(titles({ launch: currentRecordsContext().launch })).not.toContain('Earlier launch')
    expect(titles({ launch: '2026-01-01T00:00:00.000Z' })).toEqual(['Earlier launch'])
    expect(titles({ session: 'old-session' })).toEqual(['Earlier launch'])
    expect(titles({ kind: 'ai-call' })).toEqual(['gemini brainstorm', 'openai image'])
    expect(titles({ kind: 'log', level: 'info' })).toEqual(['Earlier launch', 'Task enqueued'])
    expect(titles({ level: 'attention' })).toEqual(['Careful', 'Generation failed', 'gemini brainstorm'])
    expect(titles({ level: 'error' })).toEqual(['Generation failed', 'gemini brainstorm'])
    // The search reaches the stored JSON and the ids, and its wildcards are literal.
    expect(titles({ search: 'a fox' })).toEqual(['Task enqueued', 'openai image'])
    expect(titles({ search: '  r1 ' })).toEqual(['gemini brainstorm'])
    expect(titles({ search: '50%_' })).toEqual(['Careful'])
    expect(titles({ search: '5_%' })).toEqual([])
    db.close()
  })

  it('continues a long list from the last record of the page before', () => {
    const dir = freshRecordsRoot()
    for (let index = 0; index < RECORDS_PAGE_SIZE + 5; index++) {
      // Two records share each time, so the cursor has to break ties by kind and id.
      const time = `2026-01-03T00:00:${String(Math.floor(index / 2)).padStart(2, '0')}.000Z`
      writeLogRecord(time, 'info', `line ${index}`, {})
    }
    const db = open(dir)
    const first = readPage(db, query())
    expect(first.records).toHaveLength(RECORDS_PAGE_SIZE)
    expect(first.more).toBe(true)
    const last = first.records.at(-1)!
    const second = readPage(db, query({ after: { time: last.time, kind: last.kind, id: last.id } }))
    expect(second.more).toBe(false)
    const ids = [...first.records, ...second.records].map((record) => record.id)
    expect(new Set(ids).size).toBe(RECORDS_PAGE_SIZE + 5)
    db.close()
  })
})

describe('CLI job records', () => {
  it('list as the CLI and the job kind with the target, reading their level from how they ended', () => {
    const db = open(seedJobs())
    const jobs = readPage(db, query({ kind: 'cli-job' })).records
    expect(jobs.map(({ kind, level, title, text }) => ({ kind, level, title, text })).sort((a, b) => a.text!.localeCompare(b.text!))).toEqual([
      { kind: 'cli-job', level: 'error', title: 'draw-things-cli download', text: 'failed.ckpt' },
      { kind: 'cli-job', level: 'info', title: 'draw-things-cli download', text: 'ok.ckpt' },
      { kind: 'cli-job', level: 'warn', title: 'draw-things-cli download', text: 'stopped.ckpt' },
    ])
    db.close()
  })

  it('filter by kind, level and search, reaching their output and job id', () => {
    const db = open(seedJobs())
    const texts = (overrides: Partial<RecordsQuery>) => readPage(db, query(overrides)).records.map((record) => record.text ?? record.title).sort()
    expect(texts({})).toEqual(['CLI job finished', 'failed.ckpt', 'ok.ckpt', 'stopped.ckpt'])
    expect(texts({ kind: 'log' })).toEqual(['CLI job finished'])
    expect(texts({ kind: 'ai-call' })).toEqual([])
    expect(texts({ level: 'attention' })).toEqual(['failed.ckpt', 'stopped.ckpt'])
    expect(texts({ search: 'checksum' })).toEqual(['failed.ckpt'])
    expect(texts({ kind: 'cli-job', search: 'j-ok' })).toEqual(['ok.ckpt'])
    expect(texts({ session: '20260103-000000-000-utc', kind: 'cli-job' })).toHaveLength(3)
    db.close()
  })

  it('name their launch and session among the sources, and read whole', () => {
    const db = open(seedJobs())
    expect(readSources(db).sessions).toEqual(['20260103-000000-000-utc'])
    const [failed] = readPage(db, query({ kind: 'cli-job', level: 'error' })).records
    const detail = readDetail(db, 'cli-job', failed!.id)
    expect(detail).toMatchObject({
      kind: 'cli-job', level: 'error', title: 'draw-things-cli download', sessionId: '20260103-000000-000-utc',
      launch: currentRecordsContext().launch, jobId: 'j-failed', jobKind: 'download', target: 'failed.ckpt',
      cliPath: '/bin/draw-things-cli', startedAt: '2026-01-03T00:00:00.000Z', status: 'exited', exitCode: 1,
      signal: null, stdout: '', stderr: 'checksum mismatch\n', error: null,
    })
    expect(JSON.parse((detail as { args: string }).args)).toEqual(['models', 'ensure', '--model', 'failed.ckpt'])
    expect(readDetail(db, 'cli-job', 99_999)).toBeNull()
    db.close()
  })
})

describe('records sources and detail', () => {
  it('names every launch and session that has records, newest first', () => {
    const dir = seed()
    const db = open(dir)
    expect(readSources(db)).toEqual({
      launches: [currentRecordsContext().launch, '2026-01-01T00:00:00.000Z'],
      sessions: ['20260102-000000-000-utc', 'old-session'],
    })
    db.close()
  })

  it('reads one record whole, every column as stored', () => {
    const dir = seed()
    const db = open(dir)
    const [call] = readPage(db, query({ kind: 'ai-call', level: 'error' })).records
    const detail = readDetail(db, 'ai-call', call!.id)
    expect(detail).toMatchObject({
      kind: 'ai-call', backend: 'gemini', model: 'gemini-x', purpose: 'brainstorm', requestId: 'r1', taskId: null,
      sessionId: '20260102-000000-000-utc', response: null, launch: currentRecordsContext().launch,
    })
    expect(JSON.parse((detail as { request: string }).request)).toEqual({ seed: 'fox' })
    expect(JSON.parse((detail as { error: string }).error)).toMatchObject({ message: 'quota' })
    expect(typeof (detail as { durationMs: number }).durationMs).toBe('number')

    const [line] = readPage(db, query({ search: 'Task enqueued' })).records
    expect(runRecordsRead(db, { op: 'detail', kind: 'log', id: line!.id })).toMatchObject({
      kind: 'log', level: 'info', message: 'Task enqueued', taskId: 't1', fields: JSON.stringify({ prompt: 'a fox' }),
    })
    expect(readDetail(db, 'log', 99_999)).toBeNull()
    db.close()
  })
})
