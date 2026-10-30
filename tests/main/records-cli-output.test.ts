import fs from 'node:fs'
import os from 'node:os'
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

  it('moves output kept in records/cli to cli-output once, removing the emptied records folder', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-records-move-'))
    try {
      fs.mkdirSync(path.join(root, 'records', 'cli'), { recursive: true })
      fs.writeFileSync(path.join(root, 'records', 'cli', 'old-stdout.log'), 'kept')
      openRecords(root)
      expect(fs.readFileSync(path.join(root, 'cli-output', 'old-stdout.log'), 'utf8')).toBe('kept')
      expect(fs.existsSync(path.join(root, 'records'))).toBe(false)
    } finally {
      await closeRecords()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  // A launch whose move failed may run a job that makes cli-output/ before the
  // next launch tries again; the old files still join it.
  it('moves old output into a cli-output folder a job already made, leaving a file whose name is taken', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imagequeue-records-merge-'))
    try {
      fs.mkdirSync(path.join(root, 'records', 'cli'), { recursive: true })
      fs.mkdirSync(path.join(root, 'cli-output'))
      fs.writeFileSync(path.join(root, 'records', 'cli', 'old-stdout.log'), 'old')
      fs.writeFileSync(path.join(root, 'records', 'cli', 'taken.log'), 'old taken')
      fs.writeFileSync(path.join(root, 'cli-output', 'new-stdout.log'), 'new')
      fs.writeFileSync(path.join(root, 'cli-output', 'taken.log'), 'new taken')
      openRecords(root)
      expect(fs.readdirSync(path.join(root, 'cli-output')).sort()).toEqual(['new-stdout.log', 'old-stdout.log', 'taken.log'])
      expect(fs.readFileSync(path.join(root, 'cli-output', 'old-stdout.log'), 'utf8')).toBe('old')
      expect(fs.readFileSync(path.join(root, 'cli-output', 'taken.log'), 'utf8')).toBe('new taken')
      expect(fs.readdirSync(path.join(root, 'records', 'cli'))).toEqual(['taken.log'])
      await closeRecords()
      // Once the name is free, the next launch finishes the move.
      fs.renameSync(path.join(root, 'cli-output', 'taken.log'), path.join(root, 'cli-output', 'newer.log'))
      openRecords(root)
      expect(fs.readFileSync(path.join(root, 'cli-output', 'taken.log'), 'utf8')).toBe('old taken')
      expect(fs.existsSync(path.join(root, 'records'))).toBe(false)
    } finally {
      await closeRecords()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
