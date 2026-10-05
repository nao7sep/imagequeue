import { afterEach, describe, expect, it } from 'vitest'
import os from 'os'
import path from 'path'
import type { WebContents } from 'electron'
import {
  getCliJobSnapshot,
  killAllCliJobsAndWait,
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

afterEach(async () => {
  await killAllCliJobsAndWait({ killGraceMs: 20, timeoutMs: 2_000 })
})

// CLI jobs run the Draw Things CLI, which exists only on macOS; the jobs here
// are POSIX shell scripts.
describe.skipIf(process.platform === 'win32')('CLI job shutdown barrier', () => {
  it('does not return until the signalled child closes', async () => {
    const jobId = startCliJob({
      kind: 'download',
      // A shell starts far faster than Node. Ignoring TERM survives the exec, so
      // only the barrier's follow-up kill ends the sleep.
      cliPath: '/bin/sh',
      args: ['-c', "trap '' TERM; echo ready; exec sleep 60"],
      target: 'shutdown-test',
      logContext: { test: true },
    })
    await observeJob(jobId, (snapshot) =>
      snapshot.chunks.some((chunk) => chunk.text === 'ready')
    )

    await expect(killAllCliJobsAndWait({ killGraceMs: 40, timeoutMs: 2_000 }))
      .resolves.toEqual({ signalled: 1, settled: true })
    expect(getCliJobSnapshot(jobId)?.status).toBe('killed')
  })

  it('keeps a hostile spawn diagnostic out of the visible terminal chunks', async () => {
    const hostile = 'EACCES Error invoking remote method IPC hostile-sentinel'
    const jobId = startCliJob({
      kind: 'download',
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
