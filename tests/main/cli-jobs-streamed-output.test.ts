import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { getCliJobSnapshot, killAllCliJobsAndWait, startCliJob } from '../../src/main/cli-jobs'
import { closeRecords, flushRecords } from '../../src/main/records'
import { CLI_OUTPUT_WRITE_TIMEOUT_MS } from '../../src/main/cli-output-writer'
import { freshRecordsRoot, readRows, removeRecordsRoots } from './records-fixture'

const start = (script: string) => startCliJob({ kind: 'download', cliPath: process.execPath, args: ['-e', script], target: 'fixture', modelsDir: '/fixture/models', sourceIdentity: 'fixture', logContext: {} })
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await killAllCliJobsAndWait() })
afterAll(async () => { await closeRecords(); removeRecordsRoots() })

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

describe('acquisition CLI output streaming through the real guardian', () => {
  it('retains output larger than the metadata mailbox budget with bounded live presentation and a tiny metadata row', async () => {
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
    await vi.waitFor(() => expect(getCliJobSnapshot(job)?.status).toBe('exited'), { timeout: 5000 })
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
    expect(snapshot.chunks.every((chunk) => chunk.text.length <= 16 * 1024)).toBe(true)
    expect(snapshot.chunks.at(-1)!.text).toBe('final-stream-sentinel')
  })

  it('releases a real job paused by stalled diagnostic IO after the optional deadline, while retaining the pending FD until settlement', async () => {
    const root = freshRecordsRoot()
    const originalWrite = fs.write
    const held: Array<() => void> = []
    vi.spyOn(fs, 'write').mockImplementation(((...args: unknown[]) => {
      held.push(() => Reflect.apply(originalWrite, fs, args))
    }) as typeof fs.write)
    const close = vi.spyOn(fs, 'close')
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers()
    try {
      const job = start("process.stdout.write('x'.repeat(65536))")
      await vi.waitFor(() => expect(held).toHaveLength(1))
      await vi.waitFor(() => expect(getCliJobSnapshot(job)?.status).toBe('exited'))
      let flushed = false
      const flush = flushRecords().then(() => { flushed = true })
      await Promise.resolve()
      expect(flushed).toBe(false)
      vi.advanceTimersByTime(CLI_OUTPUT_WRITE_TIMEOUT_MS)
      await flush
      const row = readRows(root, 'cli_jobs')[0]!
      expect(row).toMatchObject({ status: 'exited', exit_code: 0, error: null })
      expect(JSON.parse(row.output_error as string)).toEqual([expect.objectContaining({ message: expect.stringContaining('no progress') })])
      expect(reported).not.toHaveBeenCalled()
      expect(readRows(root, 'log_records').some((entry) => entry.message === 'CLI output could not be retained' && entry.level === 'warn')).toBe(true)
      expect(close).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      for (const release of held.splice(0)) release()
      await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
    }
  })
})
