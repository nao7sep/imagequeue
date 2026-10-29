import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { getCliJobSnapshot, stopAllCliJobs, startCliJob } from '../../src/main/cli-jobs'
import { closeRecords, flushRecords } from '../../src/main/records'
import { freshRecordsRoot, readRows, removeRecordsRoots } from './records-fixture'
import { until } from '../renderer/until'

const start = (script: string) => startCliJob({ kind: 'download', cliPath: process.execPath, args: ['-e', script], target: 'fixture', modelsDir: '/fixture/models', sourceIdentity: 'fixture', logContext: {} })
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await stopAllCliJobs() })
afterAll(async () => { await closeRecords(); removeRecordsRoots() })

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

describe('acquisition CLI output streaming from a real child', () => {
  it('retains output larger than the metadata mailbox budget with a bounded live line ring and a tiny metadata row', async () => {
    const root = freshRecordsRoot()
    const job = start(`
      const { once } = require('node:events');
      (async () => {
        const chunk = 'x'.repeat(65536);
        for (let index = 0; index < 320; index++) {
          if (!process.stdout.write(chunk)) await once(process.stdout, 'drain');
        }
        process.stdout.write('\\rfinal-stream-sentinel\\n');
      })();
    `)
    await until(() => expect(getCliJobSnapshot(job)?.status).toBe('exited'))
    await flushRecords()
    const row = readRows(root, 'cli_jobs')[0]!
    expect(row).toMatchObject({ exit_code: 0, stdout: '', stderr: '', error: null, output_error: null })
    expect(Buffer.byteLength(JSON.stringify(row))).toBeLessThan(4096)
    const file = path.join(root, 'records/cli', row.stdout_file as string)
    const sentinel = '\rfinal-stream-sentinel\n'
    expect(fs.statSync(file).size).toBe(20 * 1024 * 1024 + Buffer.byteLength(sentinel))
    const expected = createHash('sha256')
    for (let index = 0; index < 320; index++) expected.update('x'.repeat(65536))
    expected.update(sentinel)
    expect(await hashFile(file)).toBe(expected.digest('hex'))
    const snapshot = getCliJobSnapshot(job)!
    expect(snapshot.chunks.length).toBeLessThanOrEqual(2000)
    expect(snapshot.chunks.at(-1)!.text).toBe('final-stream-sentinel')
  })

})
