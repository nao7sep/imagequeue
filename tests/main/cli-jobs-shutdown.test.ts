import { afterEach, describe, expect, it } from 'vitest'
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

afterEach(async () => {
  await killAllCliJobsAndWait({ killGraceMs: 20, timeoutMs: 2_000 })
})

describe('CLI job shutdown barrier', () => {
  it('does not return at TERM and waits through KILL until the child closes', async () => {
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

    const started = Date.now()
    await expect(killAllCliJobsAndWait({ killGraceMs: 40, timeoutMs: 2_000 }))
      .resolves.toEqual({ signalled: 1, settled: true })
    expect(Date.now() - started).toBeGreaterThanOrEqual(30)
    expect(getCliJobSnapshot(jobId)?.status).toBe('killed')
  })
})
