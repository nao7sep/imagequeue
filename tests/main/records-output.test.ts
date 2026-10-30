import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openRecords, closeRecords, write } from '../../src/main/records-storage'
import { readDetail, readOutput, readPage, runRecordsRead } from '../../src/main/records-query'
import { RECORDS_OUTPUT_PAGE_SIZE, type RecordsQuery } from '../../src/shared/records'

const query = (search: string): RecordsQuery => ({ launch: null, session: null, kind: 'cli-job', level: null, search, after: null })
describe('recorded CLI output paging and search with real SQLite/files', () => {
  let root: string
  let db: DatabaseSync
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-record-output-'))
    openRecords(root)
    db = new DatabaseSync(path.join(root, 'records.sqlite3'))
  })
  afterEach(() => { db.close(); closeRecords(); fs.rmSync(root, { recursive: true, force: true }) })
  function row(overrides: Record<string, string | number | null> = {}): number {
    write('cli_jobs', {
      time: '2026-10-24T00:00:00.000Z', launch: 'launch', session_id: null, job_id: randomUUID(),
      job_kind: 'download', target: 'model', cli_path: '/cli', args: '[]', started_at: null,
      ended_at: '2026-10-24T00:00:01.000Z', status: 'exited', exit_code: 0, signal: null,
      stdout: '', stderr: '', error: null, ...overrides,
    })
    return Number((db.prepare('SELECT MAX(id) AS id FROM cli_jobs').get() as { id: number }).id)
  }
  function file(text: string, stream = 'stdout'): string {
    const basename = `20261024-000000-utc-${randomUUID()}-${stream}.log`
    fs.mkdirSync(path.join(root, 'cli-output'), { recursive: true })
    fs.writeFileSync(path.join(root, 'cli-output', basename), text, 'utf8')
    return basename
  }

  it('adds nullable columns to a supported old store without rewriting legacy output or its format', () => {
    const text = 'historical raw\r\n😀é\n'
    const id = row({ stdout: text })
    const before = db.prepare('SELECT * FROM cli_jobs WHERE id = ?').get(id)!
    const format = db.prepare('PRAGMA user_version').get()
    closeRecords()
    db.exec('ALTER TABLE cli_jobs DROP COLUMN stdout_file; ALTER TABLE cli_jobs DROP COLUMN stderr_file; ALTER TABLE cli_jobs DROP COLUMN output_error')
    openRecords(root)
    expect(db.prepare('PRAGMA user_version').get()).toEqual(format)
    expect(db.prepare('SELECT * FROM cli_jobs WHERE id = ?').get(id)).toEqual(before)
    expect(readDetail(db, 'cli-job', id)).toMatchObject({ hasStdout: true, hasStderr: false, outputError: null })
    expect(readOutput(db, id, 'stdout', 0)).toEqual({ text, nextOffset: null })
    expect(row({ stdout: 'a later inline caller' })).toBe(id + 1)
    expect(db.prepare('SELECT stdout_file, stderr_file, output_error FROM cli_jobs WHERE id = ?').get(id + 1))
      .toEqual({ stdout_file: null, stderr_file: null, output_error: null })
  })

  it('keeps metadata bounded and reconstructs legacy NULs and Unicode through opaque byte cursors', () => {
    const raw = ('\0😀漢é\r\n').repeat(RECORDS_OUTPUT_PAGE_SIZE)
    const id = row({ stdout: raw })
    const detail = readDetail(db, 'cli-job', id)!
    expect(detail).toMatchObject({ hasStdout: true, hasStderr: false, outputError: null })
    expect(detail).not.toHaveProperty('stdout')
    expect(detail).not.toHaveProperty('stderr')
    let offset: number | null = 0
    let combined = ''
    while (offset !== null) {
      const page = readOutput(db, id, 'stdout', offset)
      expect(Array.from(page.text).length).toBeLessThanOrEqual(RECORDS_OUTPUT_PAGE_SIZE)
      combined += page.text
      if (page.nextOffset !== null) expect(page.nextOffset).toBe(offset + Buffer.byteLength(page.text))
      offset = page.nextOffset
    }
    expect(combined).toBe(raw)
    expect(readOutput(db, id, 'stderr', 0)).toEqual({ text: '', nextOffset: null })
    const nul = row({ stdout: '\0' })
    expect(readDetail(db, 'cli-job', nul)).toMatchObject({ hasStdout: true })
    expect(readOutput(db, nul, 'stdout', 0)).toEqual({ text: '\0', nextOffset: null })
  })

  it.each([1, 2, 3])('reconstructs file output when a four-byte character crosses the page boundary by %i bytes', (before) => {
    const raw = 'x'.repeat(RECORDS_OUTPUT_PAGE_SIZE - before) + '😀漢é\r\n'.repeat(20000)
    const stdout = file(raw)
    const stderr = file('', 'stderr')
    const id = row({ stdout_file: stdout, stderr_file: stderr, output_error: 'stderr capture unavailable' })
    expect(readDetail(db, 'cli-job', id)).toMatchObject({ hasStdout: true, hasStderr: true, outputError: 'stderr capture unavailable' })
    let offset: number | null = 0
    let combined = ''
    while (offset !== null) {
      const page = runRecordsRead(db, { op: 'output', id, stream: 'stdout', offset }) as ReturnType<typeof readOutput>
      combined += page.text
      expect(Buffer.byteLength(page.text)).toBeLessThanOrEqual(RECORDS_OUTPUT_PAGE_SIZE + 3)
      expect(page.text).not.toContain('\uFFFD')
      if (page.nextOffset !== null) expect(page.nextOffset).toBe(offset + Buffer.byteLength(page.text))
      offset = page.nextOffset
    }
    expect(combined).toBe(raw)
    expect(readOutput(db, id, 'stderr', 0)).toEqual({ text: '', nextOffset: null })
  })

  it('searches complete files across UTF-8/read boundaries with literal LIKE and ASCII case semantics', () => {
    const output = 'x'.repeat(RECORDS_OUTPUT_PAGE_SIZE - 2) + 'A😀B%_É' + 'x'.repeat(RECORDS_OUTPUT_PAGE_SIZE * 2) + 'FarBeyondFirstPage'
    const id = row({ stdout_file: file(output) })
    const hits = (needle: string) => readPage(db, query(needle)).records.map((record) => record.id)
    expect(hits('a😀b%_É')).toEqual([id])
    expect(hits('a😀b%_é')).toEqual([])
    expect(hits('farbeyondfirstpage')).toEqual([id])
    expect(hits('b%_')).toEqual([id])
    expect(hits('b_%')).toEqual([])
    const legacy = row({ stdout: output })
    for (const needle of ['a😀b%_É', 'a😀b%_é', 'farbeyondfirstpage', 'b%_', 'b_%']) {
      const found = hits(needle)
      expect(found.includes(id)).toBe(found.includes(legacy))
    }
  })

  it('searches stderr files and preserves the ordered indexes while searching', () => {
    const id = row({ stderr_file: file('x'.repeat(RECORDS_OUTPUT_PAGE_SIZE * 2) + 'Needle', 'stderr') })
    expect(readPage(db, query('needle')).records.map((record) => record.id)).toEqual([id])
    const indexes = db.prepare('PRAGMA index_list(cli_jobs)').all().map((index) => index.name)
    expect(indexes).toEqual(expect.arrayContaining(['cli_jobs_time', 'cli_jobs_launch_time', 'cli_jobs_session_time']))
  })

  it('keeps unrelated matches and complete diagnostics when one output is unavailable, then recovers', () => {
    const reference = `20261024-000000-utc-${randomUUID()}-stdout.log`
    const missing = row({ stdout_file: reference })
    const healthy = row({ stderr_file: file('a needle in intact output', 'stderr') })
    write('log_records', { time: '2026-10-24T00:00:03.000Z', launch: 'launch', session_id: null,
      task_id: null, request_id: null, level: 'info', message: 'needle in a log', fields: '{}' })
    const report = vi.fn()
    const page = readPage(db, { ...query('needle'), kind: null }, report)
    expect(page.searchIncomplete).toBe(true)
    expect(page.records.map((item) => item.kind)).toEqual(['log', 'cli-job'])
    expect(page.records[1]!.id).toBe(healthy)
    expect(report).toHaveBeenCalledOnce()
    expect(report).toHaveBeenCalledWith({ unavailableInputs: 1, first: {
      jobId: missing, stream: 'stdout', reference,
      error: expect.objectContaining({ code: 'ENOENT', path: path.join(fs.realpathSync(root), 'cli-output', reference), stack: expect.any(String) }),
    } })
    fs.writeFileSync(path.join(root, 'cli-output', reference), 'recovered needle')
    const recovered = readPage(db, { ...query('needle'), kind: null }, report)
    expect(recovered.searchIncomplete).toBeUndefined()
    expect(recovered.records.map((item) => item.id)).toContain(missing)
    expect(report).toHaveBeenCalledOnce()
  })

  it('reports incomplete captured output even when its retained bytes remain readable', () => {
    row({ stdout_file: file('partial bytes'), output_error: 'capture was interrupted' })
    expect(readPage(db, query('absent'))).toMatchObject({ records: [], searchIncomplete: true })
    expect(readPage(db, query(''))).not.toHaveProperty('searchIncomplete')
  })

  it('rejects references outside the writer filename/stream contract and reports missing output', () => {
    for (const ref of ['../elsewhere', '/tmp/out.log', `${randomUUID()}-stdout.log`, `20261024-000000-utc-${randomUUID()}-stderr.log`]) {
      const id = row({ stdout_file: ref })
      expect(() => readOutput(db, id, 'stdout', 0)).toThrow('Invalid CLI output file reference')
      expect(readPage(db, query('unmatched'))).toEqual({ records: [], more: false, searchIncomplete: true })
      db.prepare('DELETE FROM cli_jobs WHERE id = ?').run(id)
    }
    const id = row({ stdout_file: `20261024-000000-utc-${randomUUID()}-stdout.log` })
    expect(() => readOutput(db, id, 'stdout', 0)).toThrow('ENOENT')
    expect(readPage(db, query('unmatched'))).toEqual({ records: [], more: false, searchIncomplete: true })
    expect(() => readOutput(db, 999999, 'stdout', 0)).toThrow('no longer exists')
  })
})
