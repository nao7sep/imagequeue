import { afterEach, describe, expect, it } from 'vitest'
import os from 'os'
import path from 'path'
import type { WebContents } from 'electron'
import {
  getCliJobSnapshot,
  stopAllCliJobs,
  startCliJob,
  subscribeCliJob,
  unsubscribeCliJob,
} from '../../src/main/cli-jobs'
import type { CliJobSnapshot } from '../../src/shared/cli-jobs'

function observeJob(
  jobId: string,
  matches: (snapshot: CliJobSnapshot) => boolean,
): Promise<CliJobSnapshot> {
  return new Promise((resolve) => {
    let finished = false
    const subscriber = {
      isDestroyed: () => false,
      once: () => subscriber,
      off: () => subscriber,
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
    // The subscription's first event is the job as it is now.
    subscribeCliJob(jobId, subscriber)
  })
}

afterEach(async () => {
  await stopAllCliJobs(20)
})

describe('CLI job shutdown barrier', () => {
  it('does not return until the signalled child closes', async () => {
    const jobId = startCliJob({
      kind: 'download', modelsDir: '/test/models', sourceIdentity: 'model.ckpt',
      cliPath: process.execPath,
      args: ['-e', "process.stdout.write('ready\\n'); setInterval(() => {}, 1000)"],
      target: 'shutdown-test',
      logContext: { test: true },
    })
    await observeJob(jobId, (snapshot) =>
      snapshot.chunks.some((chunk) => chunk.text === 'ready')
    )

    await expect(stopAllCliJobs(40))
      .resolves.toBeUndefined()
    expect(getCliJobSnapshot(jobId)?.status).toBe('killed')
  })

  it.skipIf(process.platform === 'win32')('escalates when a POSIX child ignores termination', async () => {
    const jobId = startCliJob({
      kind: 'download', modelsDir: '/test/models', sourceIdentity: 'model.ckpt',
      cliPath: process.execPath,
      args: ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setInterval(() => {}, 1000)"],
      target: 'shutdown-escalation-test',
      logContext: { test: true },
    })
    await observeJob(jobId, (snapshot) => snapshot.chunks.some((chunk) => chunk.text === 'ready'))
    await expect(stopAllCliJobs(40))
      .resolves.toBeUndefined()
    expect(getCliJobSnapshot(jobId)?.status).toBe('killed')
  })

  it('keeps a hostile spawn diagnostic out of the visible terminal chunks', async () => {
    const hostile = 'EACCES Error invoking remote method IPC hostile-sentinel'
    const jobId = startCliJob({
      kind: 'download', modelsDir: '/test/models', sourceIdentity: 'model.ckpt',
      cliPath: path.join(os.tmpdir(), hostile),
      args: [],
      target: 'failure-presentation-test',
      logContext: { test: true },
    })
    await observeJob(jobId, (snapshot) =>
      snapshot.status === 'exited' || snapshot.status === 'killed'
    )

    const snapshot = getCliJobSnapshot(jobId)
    expect(snapshot?.chunks.map((chunk) => chunk.text).join('\n'))
      .toContain('model download could not be started')
    expect(snapshot?.chunks.map((chunk) => chunk.text).join('\n')).not.toContain(hostile)
    expect(snapshot?.chunks.map((chunk) => chunk.text).join('\n')).not.toContain('ENOENT')
  })
})
