import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { closeRecords, flushRecords, openRecords, startAiCall, startCliJobRecord } from '../../src/main/records'
import { freshRecordsRoot, readRows, removeRecordsRoots } from './records-fixture'
import { until } from '../renderer/until'

const job = { jobId: 'streamed', kind: 'download', target: 'model.ckpt', cliPath: '/cli', args: [] }
const end = { startedAt: '2026-01-01T00:00:00.000Z', status: 'exited', exitCode: 0, signal: null }
afterAll(async () => { await closeRecords(); removeRecordsRoots() })

describe('CLI records with streamed diagnostics', () => {
  it('flushes complete large streams and masks arbitrary credential boundaries before writing files', async () => {
    const root = freshRecordsRoot()
    const escapedCredential = 'quoted"\\credential'
    startAiCall({ backend: 'openai', model: 'm', purpose: 'image', request: {}, credentials: ['stream-key', escapedCredential] })
    const record = startCliJobRecord({ ...job, target: 'stream-key', cliPath: '/stream-key/cli', args: ['stream-key', escapedCredential] })
    const piece = '日本語 😀\r'.repeat(5000)
    for (let index = 0; index < 10; index++) {
      let resume!: () => void
      const drained = new Promise<void>((resolve) => { resume = resolve })
      if (!record.append('stdout', piece, resume)) await drained
    }
    for (const text of ['stream-', 'key\r\nhttps://host?si', "g=long'signature", '&rest=kept']) record.append('stderr', text, () => {})
    record.append('stderr', '\n' + escapedCredential, () => {})
    record.finish(end)
    await flushRecords()
    const row = readRows(root, 'cli_jobs')[0]!
    expect(row).toMatchObject({ stdout: '', stderr: '', error: null, output_error: null, target: '[REDACTED]', cli_path: '/[REDACTED]/cli' })
    expect(JSON.parse(row.args as string)).toEqual(['[REDACTED]', '[REDACTED]'])
    const stdoutFile = row.stdout_file as string
    const stderrFile = row.stderr_file as string
    expect(stdoutFile).toMatch(/^\d{8}-\d{6}-utc-[a-f\d-]+-stdout\.log$/)
    expect(stderrFile).toBe(stdoutFile.replace('-stdout.log', '-stderr.log'))
    expect(fs.readFileSync(path.join(root, 'cli-output', stdoutFile), 'utf8')).toBe(piece.repeat(10))
    expect(fs.readFileSync(path.join(root, 'cli-output', stderrFile), 'utf8')).toBe('[REDACTED]\r\nhttps://host?sig=[REDACTED]&rest=kept\n[REDACTED]')
  })

  it('retains process success when output storage fails and reports a separate masked diagnostic immediately', async () => {
    const root = freshRecordsRoot()
    fs.writeFileSync(path.join(root, 'cli-output'), 'blocked')
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const record = startCliJobRecord(job)
      const resumed = vi.fn()
      record.append('stdout', 'x'.repeat(64 * 1024), resumed)
      await until(() => expect(resumed).toHaveBeenCalledOnce())
      expect(readRows(root, 'log_records')[0]).toMatchObject({ level: 'warn', message: 'CLI output could not be retained' })
      expect(report).not.toHaveBeenCalled()
      record.finish(end)
      await flushRecords()
      const row = readRows(root, 'cli_jobs')[0]!
      expect(row).toMatchObject({ status: 'exited', exit_code: 0, error: null })
      expect(JSON.parse(row.output_error as string)).toEqual([expect.objectContaining({ code: 'EEXIST' })])
    } finally { report.mockRestore() }
  })

  it('stores no file references when the process emitted no output', async () => {
    const root = freshRecordsRoot()
    startCliJobRecord(job).finish(end)
    await flushRecords()
    expect(readRows(root, 'cli_jobs')[0]).toMatchObject({ stdout_file: null, stderr_file: null, output_error: null })
    expect(fs.existsSync(path.join(root, 'cli-output'))).toBe(false)
  })
})
