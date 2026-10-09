import { afterAll, afterEach, describe, expect, it } from 'vitest'
import path from 'path'
import os from 'os'
import type { WebContents } from 'electron'
import { getCliJobSnapshot, killAllCliJobsAndWait, startCliJob, subscribeCliJob, unsubscribeCliJob } from '../../src/main/cli-jobs'
import type { CliJobSnapshot } from '../../src/shared/cli-jobs'
import { freshRecordsRoot, readRows, removeRecordsRoots } from './records-fixture'

// A finished Draw Things CLI job is kept as a record (cli-jobs.ts through
// records.ts), whatever way it ended.

function observeJob(jobId: string, matches: (snapshot: CliJobSnapshot) => boolean): Promise<CliJobSnapshot> {
  return new Promise((resolve) => {
    let finished = false
    const subscriber = {
      isDestroyed: () => false,
      once: () => subscriber,
      send: () => {
        const snapshot = getCliJobSnapshot(jobId)
        if (snapshot && matches(snapshot)) finish(snapshot)
      },
    } as unknown as WebContents
    const finish = (snapshot: CliJobSnapshot): void => {
      if (finished) return
      finished = true
      unsubscribeCliJob(jobId, subscriber)
      resolve(snapshot)
    }
    const initial = subscribeCliJob(jobId, subscriber)
    if (initial && matches(initial)) finish(initial)
  })
}

const ended = (snapshot: CliJobSnapshot): boolean => snapshot.status === 'exited' || snapshot.status === 'killed'

// Node is present wherever this suite runs; fixtures exercise the same pipe
// ownership on Windows and POSIX without relying on a shell.
const CLI = process.execPath

function startFixtureJob(script: string, cliPath = CLI): string {
  return startCliJob({ kind: 'download', cliPath, args: ['-e', script], target: 'model.ckpt', logContext: { test: true } })
}

afterEach(async () => {
  await killAllCliJobsAndWait({ killGraceMs: 20, timeoutMs: 2_000 })
})

afterAll(() => {
  removeRecordsRoots()
})

describe('CLI job records', () => {
  it('keep a job that exited with its command, times, exit code and both streams as received', async () => {
    const dir = freshRecordsRoot()
    const script = "process.stdout.write('10%\\r100%\\r\\nDone\\n'); process.stderr.write('careful\\n'); process.exitCode = 3"
    const jobId = startFixtureJob(script)
    await observeJob(jobId, ended)

    const [row] = readRows(dir, 'cli_jobs')
    expect(row).toMatchObject({
      job_id: jobId, job_kind: 'download', target: 'model.ckpt', cli_path: CLI,
      status: 'exited', exit_code: 3, signal: null, stdout: '10%\r100%\r\nDone\n', stderr: 'careful\n', error: null,
    })
    expect(JSON.parse(row!.args as string)).toEqual(['-e', script])
    const { time, started_at: startedAt, ended_at: endedAt } = row as { time: string; started_at: string; ended_at: string }
    expect(time <= startedAt && startedAt <= endedAt).toBe(true)
  })

  it('keep a job the user stopped, with the signal that ended it', async () => {
    const dir = freshRecordsRoot()
    const jobId = startFixtureJob("process.stdout.write('ready\\n'); setInterval(() => {}, 1000)")
    await observeJob(jobId, (snapshot) => snapshot.chunks.some((chunk) => chunk.text === 'ready'))
    await killAllCliJobsAndWait({ killGraceMs: 2_000, timeoutMs: 4_000 })

    const [row] = readRows(dir, 'cli_jobs')
    expect(row).toMatchObject({ job_id: jobId, status: 'killed', exit_code: null, signal: 'SIGTERM', stdout: 'ready\n' })
  })

  it('keep a job whose process could not be started, with the error', async () => {
    const dir = freshRecordsRoot()
    const jobId = startFixtureJob('', path.join(os.tmpdir(), 'imagequeue-no-such-cli'))
    await observeJob(jobId, ended)

    const [row] = readRows(dir, 'cli_jobs')
    expect(row).toMatchObject({ job_id: jobId, status: 'exited', exit_code: null, stdout: '', stderr: '' })
    expect(JSON.parse(row!.error as string)).toMatchObject({ code: 'ENOENT' })
  })
})
