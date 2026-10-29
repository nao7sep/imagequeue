import { afterAll, describe, expect, it } from 'vitest'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { readRecords, writeLogRecord } from '../../src/main/records'
import { freshRecordsRoot, readLog, removeRecordsRoots } from './records-fixture'

// Records window reads run on the records thread, after every record posted
// before them, on the writer's own connection.
const dir = freshRecordsRoot()
writeLogRecord('2026-01-01T00:00:00.000Z', 'info', 'Read on the worker', {})

afterAll(() => removeRecordsRoots())

const everything = { launch: null, session: null, kind: null, level: null, search: '', after: null }

describe('records reads', () => {
  it('answers a read after the records written before it', async () => {
    await expect(readRecords({ op: 'sources' })).resolves.toMatchObject({ sessions: [] })
    const page = await readRecords({ op: 'page', query: { ...everything, kind: 'log' } })
    expect(page.records.map((record) => record.title)).toEqual(['Read on the worker'])
  })

  it('rejects a failed read, and answers the next read', async () => {
    await expect(readRecords({ op: 'page', query: { ...everything, search: 5 as unknown as string } })).rejects.toThrow('TypeError')
    await expect(readRecords({ op: 'detail', kind: 'log', id: 99_999 })).resolves.toBeNull()
  })
})

it('logs an incomplete-search diagnostic separately from the usable page', async () => {
  const writer = new DatabaseSync(path.join(dir, 'records.sqlite3'))
  const reference = '20261024-000000-utc-00000000-0000-4000-8000-000000000000-stdout.log'
  try {
    writer.prepare(`INSERT INTO cli_jobs
      (time, launch, session_id, job_id, job_kind, target, cli_path, args, started_at, ended_at, status,
       exit_code, signal, stdout, stderr, stdout_file, output_error, error)
      VALUES ('2026-01-01T00:00:00.000Z', 'launch', NULL, 'job', 'download', 'model', '/cli', '[]', NULL,
       '2026-01-01T00:00:00.000Z', 'exited', 0, NULL, '', '', ?, NULL, NULL)`).run(reference)
  } finally { writer.close() }
  const result = await readRecords({ op: 'page', query: { ...everything, search: 'Read on the worker' } })
  expect(result).toMatchObject({ records: [{ title: 'Read on the worker' }], searchIncomplete: true })
  expect(readLog(dir).find((line) => line.message === 'CLI output search was incomplete')).toMatchObject({
    level: 'warn', unavailableInputs: 1, first: { reference, error: { code: 'ENOENT', stack: expect.any(String) } },
  })
})
