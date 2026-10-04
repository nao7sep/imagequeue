import { afterAll, describe, expect, it, vi } from 'vitest'
import { killAllCliJobsAndWait, startCliJob } from '../../src/main/cli-jobs'
import { freshRecordsRoot, readRows, removeRecordsRoots } from './records-fixture'

// An import runs in a PTY, and node-pty reports signal 0 when no signal ended
// the process; the record keeps that as no signal, not as a signal named "0".

const exits: ((event: { exitCode: number; signal?: number }) => void)[] = []

vi.mock('node-pty', () => ({
  spawn: () => ({
    onData: () => ({ dispose: () => {} }),
    onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
      exits.push(listener)
      return { dispose: () => {} }
    },
    kill: () => {},
  }),
}))

afterAll(async () => {
  await killAllCliJobsAndWait({ killGraceMs: 20, timeoutMs: 2_000 })
  removeRecordsRoots()
})

describe('an import job record', () => {
  it('keeps no signal when node-pty reports 0', async () => {
    const dir = freshRecordsRoot()
    startCliJob({ kind: 'import', cliPath: '/bin/draw-things-cli', args: ['models', 'import'], target: 'model.ckpt', logContext: {} })
    await vi.waitFor(() => expect(exits).toHaveLength(1))
    exits[0]!({ exitCode: 0, signal: 0 })

    await vi.waitFor(() => expect(readRows(dir, 'cli_jobs')).toHaveLength(1))
    expect(readRows(dir, 'cli_jobs')[0]).toMatchObject({ job_kind: 'import', status: 'exited', exit_code: 0, signal: null })
  })
})
