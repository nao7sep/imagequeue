import { afterEach, describe, expect, it } from 'vitest'
import os from 'os'
import path from 'path'
import {
  getCliJobSnapshot,
  killAllCliJobsAndWait,
  startCliJob,
} from '../../src/main/cli-jobs'

async function waitUntilReady(jobId: string): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (getCliJobSnapshot(jobId)?.chunks.some((chunk) => chunk.text === 'ready')) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('test child did not become ready')
}

async function waitUntilSettled(jobId: string): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const status = getCliJobSnapshot(jobId)?.status
    if (status === 'exited' || status === 'killed') return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('test child did not settle')
}

afterEach(async () => {
  await killAllCliJobsAndWait({ killGraceMs: 20, timeoutMs: 2_000 })
})

describe('CLI job shutdown barrier', () => {
  it('does not return until the signalled child closes', async () => {
    const jobId = startCliJob({
      kind: 'download',
      cliPath: process.execPath,
      args: [
        '-e',
        "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)",
      ],
      target: 'shutdown-test',
      logContext: { test: true },
    })
    await waitUntilReady(jobId)

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
    await waitUntilSettled(jobId)

    const snapshot = getCliJobSnapshot(jobId)
    expect(snapshot?.chunks.map((chunk) => chunk.text).join('\n'))
      .toContain('model download could not be started')
    expect(snapshot?.chunks.map((chunk) => chunk.text).join('\n')).not.toContain(hostile)
    expect(snapshot?.chunks.map((chunk) => chunk.text).join('\n')).not.toContain('ENOENT')
  })
})
